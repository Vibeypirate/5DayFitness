import type { Context } from 'grammy';

export type BotContext = Context;

export type TelegramActor = {
  telegramUserId: string;
  username?: string | null;
  firstName: string;
  lastName?: string | null;
};

export type TelegramGroupRef = {
  telegramChatId: string;
  title: string;
  username?: string | null;
};
