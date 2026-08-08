"""Papers 向量服务：bge-m3 向量化 + bge-reranker-v2-m3 重排。

部署在 GPU 服务器（/home/qishu/project/vector-service），本机 Papers 服务通过 HTTP 调用。
模型首次加载时自动从 HF 镜像下载（HF_ENDPOINT 默认 hf-mirror.com）。
"""

import gc
import os
import shutil
import threading
import time

os.environ.setdefault("HF_ENDPOINT", "https://hf-mirror.com")
# 镜像不支持 HF Xet（CAS）协议，强制走普通 HTTP 下载
os.environ.setdefault("HF_HUB_DISABLE_XET", "1")

import torch  # noqa: E402
from fastapi import FastAPI  # noqa: E402
from pydantic import BaseModel  # noqa: E402
from FlagEmbedding import BGEM3FlagModel, FlagReranker  # noqa: E402
from huggingface_hub import snapshot_download  # noqa: E402

# FlagEmbedding 1.4 用 dtype= 加载 bge-m3，但 transformers 4.x 只认 torch_dtype：
# 兼容补丁把 dtype 转发为 torch_dtype（transformers 5.x 无此问题，但重排不兼容 5.x）
import transformers  # noqa: E402

_orig_auto_from_pretrained = transformers.AutoModel.from_pretrained


def _patched_from_pretrained(*args, **kwargs):
    if "dtype" in kwargs and "torch_dtype" not in kwargs:
        kwargs["torch_dtype"] = kwargs.pop("dtype")
    return _orig_auto_from_pretrained(*args, **kwargs)


transformers.AutoModel.from_pretrained = _patched_from_pretrained

IDLE_TIMEOUT = int(os.environ.get("VECTOR_IDLE_TIMEOUT", "900"))
DEVICE = os.environ.get("VECTOR_DEVICE", "cuda:0")
MODEL_ROOT = os.environ.get(
    "VECTOR_MODEL_DIR",
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "models"),
)
# 跳过镜像上 403 的无用文件（imgs/.DS_Store 等）
IGNORE_PATTERNS = ["*.DS_Store", "**/.DS_Store", "imgs/*", "images/*"]

os.makedirs(MODEL_ROOT, exist_ok=True)

app = FastAPI(title="papers-vector-service")

_embed_model = None
_rerank_model = None
_last_use = 0.0
_embed_lock = threading.Lock()
_rerank_lock = threading.Lock()


def _touch():
    global _last_use
    _last_use = time.time()


def ensure_model(repo: str, name: str) -> str:
    local = os.path.join(MODEL_ROOT, name)
    weights_exist = any(
        os.path.exists(os.path.join(local, f))
        for f in ("model.safetensors", "pytorch_model.bin")
    )
    if not (weights_exist and os.path.exists(os.path.join(local, "tokenizer.json"))):
        # 清理上次失败留下的残缺目录后重新下载
        if os.path.isdir(local):
            shutil.rmtree(local, ignore_errors=True)
        snapshot_download(repo, local_dir=local, ignore_patterns=IGNORE_PATTERNS)
    return local


def get_embed_model() -> BGEM3FlagModel:
    global _embed_model
    _touch()
    if _embed_model is None:
        with _embed_lock:
            if _embed_model is None:
                _embed_model = BGEM3FlagModel(
                    ensure_model("BAAI/bge-m3", "bge-m3"),
                    use_fp16=True,
                    devices=DEVICE,
                )
    return _embed_model


def get_rerank_model() -> FlagReranker:
    global _rerank_model
    _touch()
    if _rerank_model is None:
        with _rerank_lock:
            if _rerank_model is None:
                _rerank_model = FlagReranker(
                    ensure_model("BAAI/bge-reranker-v2-m3", "bge-reranker-v2-m3"),
                    use_fp16=True,
                    devices=DEVICE,
                )
    return _rerank_model


def _unload_models():
    global _embed_model, _rerank_model
    _embed_model = None
    _rerank_model = None
    gc.collect()
    torch.cuda.empty_cache()


def _idle_watcher():
    while True:
        time.sleep(60)
        if _embed_model is not None or _rerank_model is not None:
            if time.time() - _last_use > IDLE_TIMEOUT:
                _unload_models()


threading.Thread(target=_idle_watcher, daemon=True).start()


class EmbedRequest(BaseModel):
    texts: list[str]
    max_length: int = 512


class RerankRequest(BaseModel):
    query: str
    passages: list[str]
    top_k: int = 10


@app.get("/health")
def health():
    return {"ok": True, "embed_loaded": _embed_model is not None, "rerank_loaded": _rerank_model is not None}


@app.post("/embed")
def embed(req: EmbedRequest):
    if not req.texts:
        return {"embeddings": [], "lexical_weights": []}
    model = get_embed_model()
    with _embed_lock:
        out = model.encode(
            req.texts,
            return_dense=True,
            return_sparse=True,
            max_length=req.max_length,
        )
    dense = out["dense_vecs"]
    sparse = out["lexical_weights"]
    return {
        "embeddings": [row.tolist() for row in dense],
        "lexical_weights": [
            {str(k): float(v) for k, v in weights.items()} for weights in sparse
        ],
    }


@app.post("/rerank")
def rerank(req: RerankRequest):
    if not req.passages:
        return {"results": []}
    model = get_rerank_model()
    pairs = [[req.query, p] for p in req.passages]
    with _rerank_lock:
        scores = model.compute_score(pairs, normalize=True)
    if isinstance(scores, torch.Tensor):
        scores = scores.tolist()
    ranked = sorted(
        range(len(req.passages)),
        key=lambda i: float(scores[i]),
        reverse=True,
    )
    top = ranked[: req.top_k]
    return {
        "results": [
            {"index": i, "score": round(float(scores[i]), 5), "text": req.passages[i]}
            for i in top
        ]
    }


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=int(os.environ.get("VECTOR_PORT", "17888")))
