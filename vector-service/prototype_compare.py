"""原型对比：FTS 关键词检索 vs bge-m3 向量 + reranker 重排（真实论文 chunk）。

用法：python prototype_compare.py <paper_id>
依赖：本机 .babeldoc-env 的 python（httpx）
"""

import json
import sys
import httpx

LOCAL = "http://localhost:3001"
REMOTE = "http://172.16.170.184:17888"


def get_chunks(paper_id: str) -> list[dict]:
    r = httpx.get(f"{LOCAL}/api/papers/{paper_id}/chunks", timeout=30)
    r.raise_for_status()
    return r.json()


def fts(paper_id: str, q: str) -> list[dict]:
    r = httpx.get(f"{LOCAL}/api/papers/{paper_id}/chunks", params={"q": q}, timeout=30)
    r.raise_for_status()
    return r.json()


def embed(texts: list[str]) -> tuple[list[list[float]], list[dict]]:
    r = httpx.post(f"{REMOTE}/embed", json={"texts": texts}, timeout=600)
    r.raise_for_status()
    data = r.json()
    return data["embeddings"], data["lexical_weights"]


def rerank(query: str, passages: list[str], top_k: int = 3) -> list[dict]:
    r = httpx.post(f"{REMOTE}/rerank", json={"query": query, "passages": passages, "top_k": top_k}, timeout=120)
    r.raise_for_status()
    return r.json()["results"]


def cosine(a: list[float], b: list[float]) -> float:
    import math

    dot = sum(x * y for x, y in zip(a, b))
    na = math.sqrt(sum(x * x for x in a))
    nb = math.sqrt(sum(y * y for y in b))
    return dot / (na * nb) if na and nb else 0.0


def main():
    paper_id = sys.argv[1] if len(sys.argv) > 1 else "2605.15246v1"
    chunks = get_chunks(paper_id)
    print(f"论文 {paper_id}：{len(chunks)} 个 chunk，开始向量化…")

    texts = [c["content"] for c in chunks]
    embeds, sparse = embed(texts)
    print(f"向量化完成：{len(embeds)} 条 × {len(embeds[0])} 维\n")

    queries = [
        "攻击者如何判断某个样本是否在模型的训练集里？",
        "轨迹数据在隐私评估中有什么风险？",
        "生成模型为什么会泄露训练数据的信息？",
    ]
    for q in queries:
        print("=" * 70)
        print(f"问题：{q}")

        f = fts(paper_id, q)[:3]
        print("\n[FTS 关键词检索 top3]")
        for i, c in enumerate(f):
            print(f"  {i + 1}. ({c['heading']}) {c['content'][:60]}…")

        q_emb, _ = embed([q])
        scored = sorted(
            range(len(chunks)),
            key=lambda i: cosine(q_emb[0], embeds[i]),
            reverse=True,
        )[:10]
        cand = [chunks[i] for i in scored]
        rr = rerank(q, [c["content"] for c in cand])
        print("\n[向量 + reranker 重排 top3]")
        for i, item in enumerate(rr):
            c = cand[item["index"]]
            print(f"  {i + 1}. [{item['score']:.3f}] ({c['heading']}) {c['content'][:60]}…")
        print()


if __name__ == "__main__":
    main()
