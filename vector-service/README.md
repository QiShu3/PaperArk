# Papers 向量服务（服务器部署）

部署在 GPU 服务器 `/home/qishu/project/vector-service/`，本机 Papers 应用通过 HTTP 调用：

- `POST /embed`：bge-m3 稠密 + 稀疏向量化
- `POST /rerank`：bge-reranker-v2-m3 交叉编码器重排
- `GET /health`：健康检查

## 启动

```bash
export HF_ENDPOINT=https://hf-mirror.com
cd /home/qishu/project/vector-service
nohup .venv/bin/python app.py > service.log 2>&1 &
```

模型首次加载自动下载（bge-m3 ~2.2GB + reranker ~1.2GB）。空闲 15 分钟自动释放显存，下次请求重新加载。

环境变量：
- `VECTOR_PORT`：服务端口（默认 17888）
- `VECTOR_DEVICE`：设备（默认 `cuda:0`）
- `VECTOR_IDLE_TIMEOUT`：空闲卸载秒数（默认 900）
