import { DynamicModule, Global, Module } from '@nestjs/common';
import { PRISMA_ADAPTER, PrismaService, type DatabaseAdapter } from './prisma.service.js';

@Global()
@Module({})
export class DatabaseModule {
  /** `adapter` overrides DATABASE_URL; leave it out in normal running. */
  static register(adapter?: DatabaseAdapter): DynamicModule {
    return {
      module: DatabaseModule,
      providers: [{ provide: PRISMA_ADAPTER, useValue: adapter ?? null }, PrismaService],
      exports: [PrismaService],
    };
  }
}
