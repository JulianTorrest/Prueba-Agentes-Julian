import { ZodObject, ZodRawShape } from "zod";

export type ToolResult = { ok: true; data?: any } | { ok: false; error: string };

export interface Tool<T extends ZodRawShape = any> {
  description: string;
  args: ZodObject<T>;
  execute(args: any, ctx: { directory: string; sessionId: string }): Promise<string> | string;
}

export interface Session {
  id: string;
  messages: { role: "user" | "assistant" | "tool"; content?: string; toolCalls?: any[] }[];
  pendingCase?: string | null;
}
