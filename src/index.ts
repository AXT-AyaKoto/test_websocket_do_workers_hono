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
    // constructor
    constructor(ctx: DurableObjectState, env: Env) {
        super(ctx, env);
    }

    // 1. HTTP(S) Requestを受け取りUpgrade Responseを返すメソッド (Workerから呼ぶ)
    async fetch(request: Request): Promise<Response> {
        // WebSocketへのUpgradeを要求していない場合は "426 Upgrade Required"で弾く
        const upgradeHeader = request.headers.get("Upgrade");
        if (upgradeHeader !== "websocket") {
            return new Response("Expected Upgrade: websocket", { status: 426 });
        }
        // WebSocketPairで、WebSocket接続の通信経路の両端に相当するオブジェクトをもらえる
        const pair = new WebSocketPair();
        // 0個目がクライアントに渡す方、1個目がサーバー側が使う方
        const [client, server] = Object.values(pair) as [WebSocket, WebSocket];
        // WebSocket接続を開くメソッド (これはDO Hibernation WebSocket API独自のもの)
        this.ctx.acceptWebSocket(server);
        // Responseでclientを返してあげる
        return new Response(null, { status: 101, webSocket: client });
    }

    // 2. 接続相手からmessageが来たときの動作を定義するメソッド
    async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
        // 一旦messageをパースする
        const data = JSON.parse(message as string) as { command: "increment" | "status" };
        // 今のカウントを取得する
        const currentCount = (await this.ctx.storage.get<number>("count")) ?? 0;
        // incrementの場合: +1したあと、全員にcountメッセージを送る
        if (data.command === "increment") {
            await this.ctx.storage.put("count", currentCount + 1);
            const connections: WebSocket[] = this.ctx.getWebSockets();
            connections.forEach((connection) => {
                connection.send(JSON.stringify({ command: "count", current: currentCount + 1 }));
            });
        }
        // statusの場合: 通信相手にだけ、countメッセージを送る
        if (data.command === "status") {
            ws.send(JSON.stringify({ command: "count", current: currentCount }));
        }
    }

    // 3. 通信がcloseされたときの動作(主に後片付け)を定義するメソッド
    async webSocketClose(ws: WebSocket, code: number, reason: string, wasClean: boolean): Promise<void> {
        // 適宜後片付けのコードを書けるが、今回は空でいい
    }
}
