import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';

import { Interest } from '../interests/models/interest.model';
import { AppConfigController, CatalogController } from './catalog.controller';
import { CatalogService } from './catalog.service';
import { Prompt } from './models/prompt.model';

/** M08: GET /catalog/interests, GET /catalog/prompts (signed in) and GET /app/config (public). */
@Module({
  imports: [SequelizeModule.forFeature([Interest, Prompt])],
  controllers: [CatalogController, AppConfigController],
  providers: [CatalogService],
})
export class CatalogModule {}
