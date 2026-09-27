import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';
import { Request, Response } from 'express';
import { randomUUID } from 'crypto';
import { HttpExceptionFilter } from './http-exception.filter';

@Catch(HttpException)
export class ThrottlerExceptionFilter implements ExceptionFilter {
  private readonly fallback = new HttpExceptionFilter();

  catch(exception: HttpException, host: ArgumentsHost) {
    // Rethrowing from a filter crashes the process; delegate everything else to the generic filter.
    if (exception.getStatus() !== HttpStatus.TOO_MANY_REQUESTS) return this.fallback.catch(exception, host);
    const response = host.switchToHttp().getResponse<Response>();
    const request = host.switchToHttp().getRequest<Request>();
    const requestId = request.headers['x-request-id'] as string || `req_${randomUUID()}`;
    response.status(HttpStatus.TOO_MANY_REQUESTS).json({ error: { code: 'RATE_LIMIT_EXCEEDED', message: 'Rate limit exceeded', details: [], requestId } });
  }
}
