import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { DataSource } from 'typeorm';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const dataSource = app.get(DataSource);
  const rows = await dataSource.query(`SELECT a.status, a.pending_human_review, c.first_name, a.auto_action, a.current_stage_id FROM job_applications a JOIN candidates c ON a.candidate_id = c.id WHERE c.first_name = 'Raju'`);
  console.log(rows);
  await app.close();
}
bootstrap();
