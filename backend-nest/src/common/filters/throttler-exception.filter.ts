import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';
import { Response } from 'express';

@Catch(HttpException)
export class ThrottlerExceptionFilter implements ExceptionFilter {
  catch(exception: HttpException, host: ArgumentsHost) {
    if (exception.getStatus() !== HttpStatus.TOO_MANY_REQUESTS) throw exception;
    const response = host.switchToHttp().getResponse<Response>();
    response.status(HttpStatus.TOO_MANY_REQUESTS).json({ error: { code: 'RATE_LIMIT_EXCEEDED', message: 'Rate limit exceeded' } });
  }
}
