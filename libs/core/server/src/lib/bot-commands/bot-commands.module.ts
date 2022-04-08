import { DynamicModule, Module } from '@nestjs/common';
import { TranslatesModule } from 'nestjs-translates';
import {
  BotCommandsConfig,
  BOT_COMMANDS_CONFIG,
} from './bot-commands-config/bot-commands.config';
import { BotСommandsToolsService } from './bot-commands-services/bot-commands-tools.service';
import { BotСommandsService } from './bot-commands-services/bot-commands.service';

@Module({
  imports: [TranslatesModule],
  providers: [BotСommandsToolsService],
  exports: [TranslatesModule, BotСommandsToolsService],
})
export class BotCommandsModule {
  static forRoot(config?: BotCommandsConfig): DynamicModule {
    return {
      module: BotCommandsModule,
      providers: [
        {
          provide: BOT_COMMANDS_CONFIG,
          useValue: <BotCommandsConfig>(config || { maxRecursiveDepth: 5 }),
        },
        BotСommandsService,
      ],
      exports: [BOT_COMMANDS_CONFIG, BotСommandsService],
    };
  }
}
