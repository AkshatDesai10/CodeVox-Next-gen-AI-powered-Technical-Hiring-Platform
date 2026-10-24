import { Body, Controller, Delete, Get, Param, Post, Put, Query } from '@nestjs/common';
import { ParseBigIntIdPipe } from '../../../common/pipes/parse-bigint-id.pipe';
import { WorkspaceService } from './workspace.service';

function ok(message: string, data: unknown) {
  return { success: true, message, data };
}

@Controller('api/assessment/workspace')
export class WorkspaceController {
  constructor(private readonly workspace: WorkspaceService) {}

  @Post(':candidateAssessmentId/provision')
  async provision(
    @Param('candidateAssessmentId', ParseBigIntIdPipe) candidateAssessmentId: string,
    @Body()
    body: {
      language?: string;
      entry_file?: string;
      files?: Record<string, string>;
    },
  ) {
    return ok(
      'Workspace provisioned',
      await this.workspace.provision(
        candidateAssessmentId,
        body.language ?? 'PHP',
        body.files,
        body.entry_file,
      ),
    );
  }

  @Get(':candidateAssessmentId')
  async status(
    @Param('candidateAssessmentId', ParseBigIntIdPipe) candidateAssessmentId: string,
  ) {
    return ok('Workspace status', await this.workspace.getStatus(candidateAssessmentId));
  }

  @Get(':candidateAssessmentId/files')
  async listFiles(
    @Param('candidateAssessmentId', ParseBigIntIdPipe) candidateAssessmentId: string,
  ) {
    return ok('Workspace files', await this.workspace.listFiles(candidateAssessmentId));
  }

  @Get(':candidateAssessmentId/files/content')
  async readFile(
    @Param('candidateAssessmentId', ParseBigIntIdPipe) candidateAssessmentId: string,
    @Query('path') path: string,
  ) {
    return ok('File content', {
      path,
      content: await this.workspace.readFile(candidateAssessmentId, path),
    });
  }

  @Put(':candidateAssessmentId/files')
  async writeFile(
    @Param('candidateAssessmentId', ParseBigIntIdPipe) candidateAssessmentId: string,
    @Body() body: { path: string; content: string },
  ) {
    return ok('File saved', await this.workspace.writeFile(candidateAssessmentId, body.path, body.content));
  }

  @Post(':candidateAssessmentId/files/sync')
  async syncFiles(
    @Param('candidateAssessmentId', ParseBigIntIdPipe) candidateAssessmentId: string,
    @Body() body: { files: Record<string, string> },
  ) {
    return ok('Files synced', await this.workspace.syncFiles(candidateAssessmentId, body.files ?? {}));
  }

  @Delete(':candidateAssessmentId/files')
  async deleteFile(
    @Param('candidateAssessmentId', ParseBigIntIdPipe) candidateAssessmentId: string,
    @Query('path') path: string,
  ) {
    return ok('File deleted', await this.workspace.deleteFile(candidateAssessmentId, path));
  }

  @Post(':candidateAssessmentId/exec')
  async exec(
    @Param('candidateAssessmentId', ParseBigIntIdPipe) candidateAssessmentId: string,
    @Body() body: { command?: string[]; stdin?: string },
  ) {
    const command = body.command?.length ? body.command : ['sh', '-lc', 'ls -la'];
    return ok('Command executed', await this.workspace.runInWorkspace(candidateAssessmentId, command, body.stdin));
  }

  @Post(':candidateAssessmentId/teardown')
  async teardown(
    @Param('candidateAssessmentId', ParseBigIntIdPipe) candidateAssessmentId: string,
  ) {
    return ok('Workspace torn down', await this.workspace.teardown(candidateAssessmentId));
  }
}
