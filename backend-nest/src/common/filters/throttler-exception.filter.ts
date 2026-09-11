import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';
import { Request, Response } from 'express';
import { randomUUID } from 'crypto';

@Catch(HttpException)
export class ThrottlerExceptionFilter implements ExceptionFilter {
  catch(exception: HttpException, host: ArgumentsHost) {
    if (exception.getStatus() !== HttpStatus.TOO_MANY_REQUESTS) throw exception;
    const response = host.switchToHttp().getResponse<Response>();
    const request = host.switchToHttp().getRequest<Request>();
    const requestId = request.headers['x-request-id'] as string || `req_${randomUUID()}`;
    response.status(HttpStatus.TOO_MANY_REQUESTS).json({ error: { code: 'RATE_LIMIT_EXCEEDED', message: 'Rate limit exceeded', details: [], requestId } });
  }
}
