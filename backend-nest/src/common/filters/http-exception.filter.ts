import { ExceptionFilter, Catch, ArgumentsHost, HttpException, HttpStatus } from '@nestjs/common';
import { Request, Response } from 'express';
import { randomUUID } from 'crypto';
import { redactSensitiveData } from '../utils/redact-sensitive-data';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();
    const requestId = request.headers['x-request-id'] as string || `req_${randomUUID()}`;

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const responseBody = exception.getResponse();
      const message = typeof responseBody === 'string' ? responseBody : (responseBody as any).message || 'Internal error';
      const code = typeof responseBody === 'string'
          ? (status === HttpStatus.TOO_MANY_REQUESTS ? 'RATE_LIMIT_EXCEEDED' : 'INTERNAL_ERROR')
          : (responseBody as any).code || (status === HttpStatus.TOO_MANY_REQUESTS ? 'RATE_LIMIT_EXCEEDED' : 'ERROR');
      const details = typeof responseBody === 'object'
        ? redactSensitiveData((responseBody as any).details)
        : undefined;

      response.status(status).json({
        error: {
          code,
          message,
          details,
          requestId,
        },
      });
      return;
    }

    response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Internal error',
        requestId,
      },
    });
  }
}
