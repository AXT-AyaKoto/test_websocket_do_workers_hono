# test_websocket_do_workers_hono

Durable Objects × WebSocketをお試し

https://zenn.dev/aya_koto/articles/b20df0d94f2dd3

```sh
pnpm install

pnpm approve-builds
# Choose which packages to build ... workerd

pnpm exec wrangler dev
```

`http://localhost:8787/`

- `GET /`でアプリ画面(簡易的なHTML+CSS+JS)を得ることができます
    - 自動でWebSocket接続が行われます
    - WebSocket通信Upgrade自体のエンドポイントは`GET /ws`
    - DOの名前は`counter-room`
        - カウントは永続ストレージAsync KV APIの`count`に持っています。
- 行われているWebSocket通信は以下の3つだけ
    - Client → Server: `{command: "increment"}` ... +1しろ、っていう命令です
    - Client → Server: `{command: "status"}` .. 現在のステータスを送ってくれ、っていう命令です
    - Server → Client: `{commnad: "count", current: number}` ... 現在のステータスです
