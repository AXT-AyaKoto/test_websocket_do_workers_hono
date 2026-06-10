// ==== Worker側 ====

import { Hono } from "hono";
// @ts-ignore: これはWranglerによって解決されるので許されます。appHtmlはstringです
import appHtml from "./app.html";
const app = new Hono<{ Bindings: Cloudflare.Env }>();

// GET / ... お試し用の簡易的なHTML+JSページを返す
app.get("/", (c) => c.html(appHtml as string));

// GET /ws ... WebSocket接続へのUpgrade
app.get("/ws", async (c) => {
    // COUNTER_ROOM_DOでDOのBindingをしているとする
    // つなぎたいDOのIDを持ってくる
    const id = c.env.COUNTER_ROOM_DO.idFromName("counter-room");
    // つなぎたいDOとやり取りするためのStubオブジェクトを持ってくる
    const stub = c.env.COUNTER_ROOM_DO.get(id);
    // そのstubのfetchにRequestを投げればいい
    const res = await stub.fetch(c.req.raw);
    return res;
});

export default app;

// ==== DO側 ====

import { DurableObject } from "cloudflare:workers";

export class CounterRoomDO extends DurableObject {
    // 現在のclientとサーバーの通信経路を保持する
    #clients = new Set<WebSocket>();

    // constructor
    constructor(ctx: DurableObjectState, env: Env) {
        super(ctx, env);
    }

    // Workerからrequestを受け取ってresponseを返すインスタンスメソッドを作っておく
    async fetch(request: Request): Promise<Response> {
        // WebSocketへのUpgradeを要求していない場合は "426 Upgrade Required"で弾く
        const upgradeHeader = request.headers.get("Upgrade");
        if (upgradeHeader !== "websocket") {
            return new Response("Expected Upgrade: websocket", { status: 426 });
        }
        // WebSocketPairで、WebSocketの通信経路の両端に相当するオブジェクトをもらえる
        const pair = new WebSocketPair();
        // 0個目がクライアントに渡すやつ、1個目がサーバー側が使うやつ
        const [client, server] = Object.values(pair) as [WebSocket, WebSocket];
        // サーバー側を開いておく
        server.accept();
        // サーバー側の処理
        // message: incrementは+1、statusは何もせずに、それぞれcountメッセージを返す
        server.addEventListener("message", async (event) => {
            const data = JSON.parse(event.data as string) as { command: "increment" | "status" };
            let currentCount = (await this.ctx.storage.get<number>("count")) ?? 0;
            if (data.command === "increment") {
                await this.ctx.storage.put("count", currentCount + 1);
                currentCount++;
            }
            if (["increment", "status"].includes(data.command)) {
                for (const client of this.#clients) {
                    client.send(JSON.stringify({ command: "count", current: currentCount }));
                }
            }
        });
        // clientを追加しておく
        this.#clients.add(server);
        // clientがcloseされたら削除しておく
        server.addEventListener("close", () => {
            this.#clients.delete(server);
        });
        // Responseでclientを返してあげる
        return new Response(null, { status: 101, webSocket: client });
    }
}
