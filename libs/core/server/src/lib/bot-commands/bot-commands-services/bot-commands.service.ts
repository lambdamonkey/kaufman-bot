import { Injectable, Logger } from '@nestjs/common';
import { CustomInject } from 'nestjs-custom-injector';
import {
  BotCommandsConfig,
  BOT_COMMANDS_CONFIG,
} from '../bot-commands-config/bot-commands.config';
import { BotCommandsEnum } from '../bot-commands-types/bot-commands-enum';
import { BotCommandsProviderActionResultType } from '../bot-commands-types/bot-commands-provider-action-result-type.interface';
import {
  BotCommandsProvider,
  BotCommandsProviderActionContext,
  BOT_COMMANDS_PROVIDER,
} from '../bot-commands-types/bot-commands-provider.interface';
import { BotCommandsProviderActionMsg } from '../bot-commands-types/bot-commands-provider-action-msg.interface';
import { OnAfterBotCommands } from '../bot-commands-types/on-after-bot-commands.interface';
import { OnBeforeBotCommands } from '../bot-commands-types/on-before-bot-commands.interface';
import { OnContextBotCommands } from '../bot-commands-types/on-context-bot-commands.interface';
import { BotCommandsToolsService } from './bot-commands-tools.service';

const DEFAULT_MAX_RECURSIVE_DEPTH = 5;
@Injectable()
export class BotCommandsService implements BotCommandsProvider {
  private logger = new Logger(BotCommandsService.name);

  private lastBotCommandRequests: {
    [telegramUserId: string]: {
      botCommandHandlerId: string;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      botCommandHandlerContext: Record<string, any>;
      request: string;
      response: BotCommandsProviderActionResultType<unknown>;
    } | null;
  } = {};

  @CustomInject(BOT_COMMANDS_PROVIDER, { multi: true })
  private botCommandsProviders!: (BotCommandsProvider &
    Partial<OnBeforeBotCommands> &
    Partial<OnAfterBotCommands> &
    Partial<OnContextBotCommands>)[];

  @CustomInject(BOT_COMMANDS_CONFIG)
  private botCommandsConfig!: BotCommandsConfig;

  constructor(
    private readonly botCommandsToolsService: BotCommandsToolsService
  ) {}

  async start(ctx) {
    const msg: BotCommandsProviderActionMsg = ctx.update.message;
    msg.botStart = true;
    await this.process(ctx);
  }

  async process(ctx, defaultHandler?: () => Promise<unknown>) {
    let msg: BotCommandsProviderActionMsg = ctx.update.message;
    if (!msg && ctx.update?.callback_query) {
      msg = ctx.update.callback_query;
    }
    if (!msg) {
      try {
        this.logger.debug(JSON.stringify(ctx));
      } catch (error) {
        this.logger.debug(ctx);
      }
      return;
    }

    let recursiveDepth = 1;
    while (
      recursiveDepth > 0 &&
      recursiveDepth <=
        (this.botCommandsConfig?.maxRecursiveDepth ||
          DEFAULT_MAX_RECURSIVE_DEPTH)
    ) {
      const result = await this.onMessage(msg, ctx, defaultHandler);

      if (result?.type === 'message') {
        msg = result.message;
      }
      if (result?.type === 'markdown') {
        const replyResult = await ctx.reply(result.markdown, {
          parse_mode: 'MarkdownV2',
          ...result.custom,
        });
        if (result.callback) {
          await result.callback(replyResult);
        }
      }
      if (result?.type === 'text') {
        const replyResult = await ctx.reply(result.text, {
          ...result.custom,
        });
        if (result.callback) {
          await result.callback(replyResult);
        }
      }

      if (result?.type !== 'stop' && result?.recursive) {
        recursiveDepth++;
      } else {
        recursiveDepth = 0;
      }
    }
  }

  async onHelp<TMsg extends BotCommandsProviderActionMsg>(
    msg: TMsg,
    ctx: BotCommandsProviderActionContext
  ): Promise<BotCommandsProviderActionResultType<TMsg>> {
    this.initBotCommandHandlerId();

    const allResults: string[] = [];
    const len = this.botCommandsProviders.length;

    let allContext: Record<string, unknown> = {};

    for (let i = 0; i < len; i++) {
      const botCommandsProvider = this.botCommandsProviders[i];

      const result = await botCommandsProvider.onHelp(msg, ctx);

      if (result !== null && result.type === 'text') {
        allResults.push(result.text);
        allContext = { ...allContext, ...(result.context || {}) };
      }

      if (result !== null && result.type === 'markdown') {
        allResults.push(result.markdown);
        allContext = { ...allContext, ...(result.context || {}) };
      }
    }
    return {
      type: 'markdown',
      message: msg,
      markdown: allResults.join('\n\n'),
      context: allContext,
    };
  }

  async onMessage<TMsg extends BotCommandsProviderActionMsg>(
    msg: TMsg,
    ctx: BotCommandsProviderActionContext,
    defaultHandler?: () => Promise<unknown>
  ): Promise<BotCommandsProviderActionResultType<TMsg>> {
    let result: BotCommandsProviderActionResultType<TMsg> = null;

    this.initBotCommandHandlerId();

    msg = await this.processOnBeforeBotCommands(msg, ctx);

    if (!msg?.botCommandHandlerBreak) {
      result = await this.processOnMessage(result, msg, ctx);
    }

    if (!msg?.botCommandHandlerBreak) {
      result = await this.processOnContext(result, msg, ctx);
    }

    if (msg?.botCommandHandlerBreak) {
      return { type: 'stop', message: msg };
    }

    if (
      result === null &&
      this.botCommandsToolsService.checkCommands(
        msg.text,
        [BotCommandsEnum.help],
        msg.from.language_code
      )
    ) {
      return this.onHelp(msg, ctx);
    }

    const afterBotCommand = await this.processOnAfterBotCommands(
      result,
      msg,
      ctx,
      defaultHandler
    );

    if (defaultHandler) {
      await defaultHandler();
    }

    return afterBotCommand.result;
  }

  async processOnBeforeBotCommands<TMsg extends BotCommandsProviderActionMsg>(
    msg: TMsg,
    ctx?: BotCommandsProviderActionContext
  ): Promise<TMsg> {
    const len = this.botCommandsProviders.length;
    for (let i = 0; i < len; i++) {
      const botCommandsProvider = this.botCommandsProviders[i];
      if (
        botCommandsProvider.onBeforeBotCommands &&
        !msg?.botCommandHandlerBreak
      ) {
        msg = await botCommandsProvider.onBeforeBotCommands(msg, ctx);
      }
    }
    return msg;
  }

  async processOnAfterBotCommands<TMsg extends BotCommandsProviderActionMsg>(
    result: BotCommandsProviderActionResultType<TMsg>,
    msg: TMsg,
    ctx?: BotCommandsProviderActionContext,
    defaultHandler?: () => Promise<unknown>
  ): Promise<{ result: BotCommandsProviderActionResultType<TMsg>; msg: TMsg }> {
    const len = this.botCommandsProviders.length;
    for (let i = 0; i < len; i++) {
      const botCommandsProvider = this.botCommandsProviders[i];
      if (botCommandsProvider.onAfterBotCommands) {
        const afterBotCommand =
          await botCommandsProvider.onAfterBotCommands<TMsg>(
            result,
            msg,
            ctx,
            defaultHandler
          );
        result = afterBotCommand.result;
        msg = afterBotCommand.msg;
      }
    }
    return { result, msg };
  }

  private async initBotCommandHandlerId() {
    const len = this.botCommandsProviders.length;
    for (let i = 0; i < len; i++) {
      if (!this.botCommandsProviders[i].botCommandHandlerId) {
        this.botCommandsProviders[i].botCommandHandlerId = i.toString();
      }
    }
  }

  private async processOnMessage<TMsg extends BotCommandsProviderActionMsg>(
    result: BotCommandsProviderActionResultType<TMsg>,
    msg: TMsg,
    ctx: BotCommandsProviderActionContext
  ) {
    if (!msg) {
      return result;
    }
    const len = this.botCommandsProviders.length;
    msg.botCommandHandlerId = null;
    for (let i = 0; i < len; i++) {
      if (!result && !msg?.botCommandHandlerBreak) {
        result = await this.botCommandsProviders[i].onMessage(msg, ctx);
        if (result) {
          msg.botCommandHandlerId =
            this.botCommandsProviders[i].botCommandHandlerId || i.toString();
        }
      }
    }
    return result;
  }

  private async processOnContext<TMsg extends BotCommandsProviderActionMsg>(
    result: BotCommandsProviderActionResultType<TMsg>,
    msg: TMsg,
    ctx: BotCommandsProviderActionContext
  ) {
    if (!msg) {
      return result;
    }
    if (
      msg.botCommandHandlerId === null &&
      this.lastBotCommandRequests[
        this.botCommandsToolsService.getChatId(msg)
      ] &&
      result === null
    ) {
      const len = this.botCommandsProviders.length;
      for (let i = 0; i < len; i++) {
        const botCommandsProvider = this.botCommandsProviders[i];
        if (
          !result &&
          this.lastBotCommandRequests[
            this.botCommandsToolsService.getChatId(msg)
          ]?.botCommandHandlerId === botCommandsProvider.botCommandHandlerId &&
          botCommandsProvider.onContextBotCommands
        ) {
          msg.botCommandHandlerContext =
            this.lastBotCommandRequests[
              this.botCommandsToolsService.getChatId(msg)
            ]?.botCommandHandlerContext || {};
          result = await botCommandsProvider.onContextBotCommands(msg, ctx);
          if (result && botCommandsProvider.botCommandHandlerId) {
            msg.botCommandHandlerId = botCommandsProvider.botCommandHandlerId;
          }
        }
      }
      if (!result) {
        this.lastBotCommandRequests[
          this.botCommandsToolsService.getChatId(msg)
        ] = null;
      }
    }
    if (result && msg.botCommandHandlerId) {
      this.lastBotCommandRequests[this.botCommandsToolsService.getChatId(msg)] =
        {
          botCommandHandlerId: msg.botCommandHandlerId,
          request: msg.text,
          response: result,
          botCommandHandlerContext: {
            ...(this.lastBotCommandRequests[
              this.botCommandsToolsService.getChatId(msg)
            ]?.botCommandHandlerContext || {}),
            ...result.context,
          },
        };
    } else {
      this.lastBotCommandRequests[this.botCommandsToolsService.getChatId(msg)] =
        null;
    }
    return result;
  }
}
