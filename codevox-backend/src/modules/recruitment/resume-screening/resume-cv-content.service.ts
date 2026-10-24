import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import { createHash } from 'crypto';
import { downloadObjectBytes } from '../../../files/local-storage';
import { extractReportText } from '../../ai-detection/text-extraction.util';
import { SCORE_CONSTANTS } from './resume-screening.constants';
import type { LeadScreenHints, ResumeCvSource } from './resume-screening.types';

export type AcquiredCvContent = {
  text: string;
  source: ResumeCvSource;
  hash: string;
  charCount: number;
  truncated: boolean;
  textForLlm: string;
};

@Injectable()
export class ResumeCvContentService {
  private readonly log = new Logger(ResumeCvContentService.name);

  async acquire(
    hints: LeadScreenHints,
    parsedResumeJson?: Record<string, unknown> | null,
    cachedExtractedText?: string | null,
  ): Promise<AcquiredCvContent | null> {
    if (cachedExtractedText?.trim() && cachedExtractedText.trim().length >= 80) {
      return this.finalize(cachedExtractedText, 'url_extract');
    }

    const url = hints.resumeUrl?.trim();
    if (url) {
      try {
        const text = await this.downloadAndExtract(url);
        if (text.trim().length >= 80) {
          return this.finalize(text, 'url_extract');
        }
      } catch (err) {
        this.log.warn(`CV download/extract failed: ${String(err)}`);
      }
    }

    const parsedBlob = this.blobFromParsed(parsedResumeJson);
    if (parsedBlob.length >= 80) {
      return this.finalize(parsedBlob, 'parsed_overlay');
    }

    const formBlob = this.blobFromForm(hints);
    if (formBlob.length >= 40) {
      return this.finalize(formBlob, 'form_only');
    }

    return null;
  }

  /** Build CV payload from already-extracted text (demo portal / tests). */
  fromExtractedText(
    raw: string,
    source: ResumeCvSource = 'url_extract',
  ): AcquiredCvContent | null {
    if (!raw?.trim() || raw.trim().length < 40) return null;
    return this.finalize(raw, source);
  }

  private finalize(raw: string, source: ResumeCvSource): AcquiredCvContent {
    const text = raw.replace(/\s+/g, ' ').trim();
    const hash = createHash('sha256').update(text).digest('hex').slice(0, 64);
    const truncated = text.length > SCORE_CONSTANTS.MAX_CV_CHARS_FOR_LLM;
    const textForLlm = truncated
      ? text.slice(0, SCORE_CONSTANTS.MAX_CV_CHARS_FOR_LLM)
      : text;
    return {
      text,
      source,
      hash,
      charCount: text.length,
      truncated,
      textForLlm,
    };
  }

  private async downloadAndExtract(url: string): Promise<string> {
    let buffer: Buffer;
    let contentType: string;
    try {
      const res = await axios.get<ArrayBuffer>(url, {
        responseType: 'arraybuffer',
        timeout: 45_000,
        maxContentLength: 15 * 1024 * 1024,
        maxBodyLength: 15 * 1024 * 1024,
        validateStatus: (s) => s >= 200 && s < 400,
      });
      buffer = Buffer.from(res.data);
      contentType = String(res.headers['content-type'] ?? '');
    } catch (err) {
      // Fall back to disk when public HTTP GET fails (e.g. local-uploads path).
      const obj = await downloadObjectBytes({ storagePath: url });
      if (!obj?.buffer.length) throw err;
      buffer = obj.buffer;
      contentType = obj.contentType;
    }
    contentType = contentType.split(';')[0]?.trim() || 'application/octet-stream';
    const fileName = this.guessFileName(url, contentType);
    return extractReportText({
      fieldname: 'resume',
      originalname: fileName,
      encoding: '7bit',
      mimetype: contentType,
      size: buffer.length,
      buffer,
      destination: '',
      filename: fileName,
      path: '',
      stream: undefined as never,
    });
  }

  private guessFileName(url: string, contentType: string): string {
    try {
      const pathname = new URL(url).pathname;
      const base = pathname.split('/').pop() || '';
      if (/\.(pdf|docx?|txt)$/i.test(base)) return decodeURIComponent(base);
    } catch {
      // ignore
    }
    if (contentType.includes('pdf')) return 'resume.pdf';
    if (contentType.includes('word') || contentType.includes('docx')) return 'resume.docx';
    return 'resume.pdf';
  }

  private blobFromParsed(parsed?: Record<string, unknown> | null): string {
    if (!parsed || typeof parsed !== 'object') return '';
    const parts: string[] = [];
    for (const key of [
      'summary',
      'experience_summary',
      'education_summary',
      'projects_summary',
      'education',
    ]) {
      const v = parsed[key];
      if (typeof v === 'string' && v.trim()) parts.push(v.trim());
    }
    if (Array.isArray(parsed.skills)) {
      parts.push(`Skills: ${parsed.skills.filter((s) => typeof s === 'string').join(', ')}`);
    }
    if (typeof parsed.experience_years === 'number') {
      parts.push(`Experience years: ${parsed.experience_years}`);
    }
    return parts.join('\n');
  }

  private blobFromForm(hints: LeadScreenHints): string {
    const parts: string[] = [];
    if (hints.experienceYears != null) {
      parts.push(`Experience years: ${hints.experienceYears}`);
    }
    if (hints.currentCompany) parts.push(`Current company: ${hints.currentCompany}`);
    if (hints.noticePeriodDays != null) {
      parts.push(`Notice period days: ${hints.noticePeriodDays}`);
    }
    if (Array.isArray(hints.educationalDetails) && hints.educationalDetails.length) {
      parts.push(`Education: ${JSON.stringify(hints.educationalDetails).slice(0, 2000)}`);
    }
    if (hints.leadsAnswers && typeof hints.leadsAnswers === 'object') {
      parts.push(`Form answers: ${JSON.stringify(hints.leadsAnswers).slice(0, 2000)}`);
    }
    if (hints.courses?.length) {
      parts.push(
        `Courses: ${hints.courses.map((c) => c.course_name).filter(Boolean).join(', ')}`,
      );
    }
    return parts.join('\n');
  }
}
