import OpenAI from 'openai';
import { env } from '../config.js';

export const openai = new OpenAI({ apiKey: env.OPENAI_API_KEY });

export type ChatMessage = { role: 'user' | 'assistant'; content: string };

/**
 * Stream chat completion deltas. Yields raw token strings as they arrive.
 * The caller is responsible for SSE framing.
 */
export async function* streamChat(
  systemPrompt: string,
  messages: ChatMessage[],
): AsyncGenerator<string, void, unknown> {
  const stream = await openai.chat.completions.create({
    model: env.OPENAI_MODEL,
    max_tokens: env.OPENAI_MAX_OUTPUT_TOKENS,
    stream: true,
    messages: [{ role: 'system', content: systemPrompt }, ...messages],
  });

  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta?.content;
    if (delta) yield delta;
  }
}
