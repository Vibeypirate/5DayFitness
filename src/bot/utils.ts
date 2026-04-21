import type { Context } from 'grammy';

import { ensureGroup, getGroupByChatId, upsertUser } from '../services/persistence.js';
import type { TelegramActor, TelegramGroupRef } from '../types.js';

export function requireGroupContext(ctx: Context): TelegramGroupRef {
  if (!ctx.chat || (ctx.chat.type !== 'group' && ctx.chat.type !== 'supergroup')) {
    throw new Error('This command only works in Telegram groups.');
  }

  return {
    telegramChatId: String(ctx.chat.id),
    title: 'title' in ctx.chat ? ctx.chat.title : 'Fitness Group',
    username: 'username' in ctx.chat ? ctx.chat.username : null,
  };
}

export function requireActor(ctx: Context): TelegramActor {
  if (!ctx.from) {
    throw new Error('Cannot resolve Telegram user.');
  }

  return {
    telegramUserId: String(ctx.from.id),
    username: ctx.from.username,
    firstName: ctx.from.first_name,
    lastName: ctx.from.last_name,
  };
}

export async function ensureGroupAndActor(ctx: Context) {
  const groupRef = requireGroupContext(ctx);
  const actorRef = requireActor(ctx);
  const [group, user] = await Promise.all([ensureGroup(groupRef), upsertUser(actorRef)]);
  return { group, user };
}

export async function requireConfiguredGroup(ctx: Context) {
  const groupRef = requireGroupContext(ctx);
  const group = await getGroupByChatId(groupRef.telegramChatId);
  if (!group?.settings) {
    throw new Error('Run /setup first.');
  }
  return group;
}

export async function requireAdmin(ctx: Context): Promise<void> {
  if (!ctx.chat || !ctx.from) {
    throw new Error('Cannot verify admin status.');
  }

  const admins = await ctx.getChatAdministrators();
  const isAdmin = admins.some((admin) => admin.user.id === ctx.from!.id);
  if (!isAdmin) {
    throw new Error('Admin command only.');
  }
}
