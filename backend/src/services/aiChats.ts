import prisma from '../lib/prisma';

/**
 * Conversations with the assistant, kept on the server.
 *
 * They used to live in the browser's memory: a refresh, an app the phone
 * put to sleep, or simply tomorrow, and the reading of the portfolio you
 * asked for was gone. Everything here is scoped to one person — every
 * lookup carries the user id, because the alternative is one mistyped id
 * away from showing somebody else's money.
 *
 * Photos are not stored. Four of them outweigh every other row in this
 * database, and what was worth keeping — the answer — is kept. A message
 * that carried photos records how many.
 */

/** Long enough to recognise, short enough for a list on a phone. */
const titleFrom = (question: string): string => {
  const line = question.replace(/\s+/g, ' ').trim();
  if (!line) return 'Photo';
  return line.length > 60 ? `${line.slice(0, 57)}…` : line;
};

/** Past this, a conversation is history nobody is coming back to. */
const MAX_AGE_DAYS = 180;
/** And no more than this many per person, newest kept. */
const MAX_CHATS_PER_USER = 100;

export interface ChatSummary {
  id: string;
  title: string;
  updatedAt: Date;
  messages: number;
}

export const listChats = async (userId: string, limit = 40): Promise<ChatSummary[]> => {
  const rows = await prisma.aiChat.findMany({
    where: { userId },
    orderBy: { updatedAt: 'desc' },
    take: limit,
    select: { id: true, title: true, updatedAt: true, _count: { select: { messages: true } } },
  });
  return rows.map(r => ({ id: r.id, title: r.title, updatedAt: r.updatedAt, messages: r._count.messages }));
};

export const getChat = async (userId: string, chatId: string) => {
  const chat = await prisma.aiChat.findFirst({
    where: { id: chatId, userId },
    include: { messages: { orderBy: { createdAt: 'asc' } } },
  });
  if (!chat) return null;
  return {
    id: chat.id,
    title: chat.title,
    updatedAt: chat.updatedAt,
    messages: chat.messages.map(m => ({
      id: m.id,
      who: m.role === 'assistant' ? 'ai' : 'me',
      text: m.text,
      photos: m.photos,
      model: m.model,
      at: m.createdAt,
      ordersSentAt: m.ordersSentAt,
    })),
  };
};

/**
 * Mark the order written out in one message as sent.
 *
 * Scoped to the asker's own conversations, and only ever set — an order
 * that has gone cannot un-go, and the card reads this to show what
 * happened instead of offering to send it again.
 */
export const markOrdersSent = async (userId: string, messageId: string): Promise<boolean> => {
  const owned = await prisma.aiMessage.findFirst({
    where: { id: messageId, chat: { userId } },
    select: { id: true, ordersSentAt: true },
  });
  if (!owned) return false;
  if (owned.ordersSentAt) return true;
  await prisma.aiMessage.update({ where: { id: messageId }, data: { ordersSentAt: new Date() } });
  return true;
};

/** The question and its answer, written together once the answer exists —
 *  a question saved on its own would come back as a conversation that
 *  stops mid-sentence if the provider failed. */
export const saveTurn = async (
  userId: string,
  chatId: string | null,
  turn: { question: string; photos: number; answer: string; model?: string },
): Promise<{ chatId: string; questionId: string; answerId: string; at: Date }> => {
  const existing = chatId
    ? await prisma.aiChat.findFirst({ where: { id: chatId, userId }, select: { id: true } })
    : null;

  const chat = existing
    ? await prisma.aiChat.update({ where: { id: existing.id }, data: { updatedAt: new Date() } })
    : await prisma.aiChat.create({ data: { userId, title: titleFrom(turn.question) } });

  const question = await prisma.aiMessage.create({
    data: { chatId: chat.id, role: 'user', text: turn.question, photos: turn.photos },
  });
  const answer = await prisma.aiMessage.create({
    data: { chatId: chat.id, role: 'assistant', text: turn.answer, ...(turn.model && { model: turn.model }) },
  });

  return { chatId: chat.id, questionId: question.id, answerId: answer.id, at: answer.createdAt };
};

export const deleteChat = async (userId: string, chatId: string): Promise<boolean> => {
  const { count } = await prisma.aiChat.deleteMany({ where: { id: chatId, userId } });
  return count > 0;
};

/**
 * Cut the conversation back to before one message.
 *
 * What editing a question means: the old question, the answer it got and
 * anything said after are gone, and the new question takes their place.
 * Leaving them would make a conversation that contradicts itself and,
 * worse, would keep feeding both versions to the model.
 */
export const truncateFrom = async (
  userId: string,
  chatId: string,
  messageId: string,
): Promise<number> => {
  const chat = await prisma.aiChat.findFirst({ where: { id: chatId, userId }, select: { id: true } });
  if (!chat) return 0;

  const from = await prisma.aiMessage.findFirst({
    where: { id: messageId, chatId: chat.id },
    select: { createdAt: true },
  });
  if (!from) return 0;

  const { count } = await prisma.aiMessage.deleteMany({
    where: { chatId: chat.id, createdAt: { gte: from.createdAt } },
  });

  // A conversation with nothing left in it is not a conversation.
  const left = await prisma.aiMessage.count({ where: { chatId: chat.id } });
  if (left === 0) await prisma.aiChat.delete({ where: { id: chat.id } });

  return count;
};

/** Old conversations, and the tail of a very long list, go quietly. */
export const cleanOldChats = async (): Promise<number> => {
  const cutoff = new Date(Date.now() - MAX_AGE_DAYS * 24 * 60 * 60 * 1000);
  const { count } = await prisma.aiChat.deleteMany({ where: { updatedAt: { lt: cutoff } } });

  const busy = await prisma.aiChat.groupBy({
    by: ['userId'],
    _count: { id: true },
    having: { id: { _count: { gt: MAX_CHATS_PER_USER } } },
  });

  let trimmed = 0;
  for (const row of busy) {
    const keep = await prisma.aiChat.findMany({
      where: { userId: row.userId },
      orderBy: { updatedAt: 'desc' },
      take: MAX_CHATS_PER_USER,
      select: { id: true },
    });
    const { count: gone } = await prisma.aiChat.deleteMany({
      where: { userId: row.userId, id: { notIn: keep.map(k => k.id) } },
    });
    trimmed += gone;
  }

  if (count + trimmed > 0) {
    console.log(`[Retention] Cleaned ${count} old AI chats and trimmed ${trimmed} over the per-person cap`);
  }
  return count + trimmed;
};
