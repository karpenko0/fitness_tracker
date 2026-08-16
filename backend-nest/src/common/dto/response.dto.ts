import { ApiProperty } from '@nestjs/swagger';

export class SuccessResponse<T> {
  @ApiProperty()
  data!: T;
}

export class ErrorDetail {
  @ApiProperty()
  field?: string;

  @ApiProperty()
  message!: string;
}

export class ErrorResponse {
  @ApiProperty()
  code!: string;

  @ApiProperty()
  message!: string;

  @ApiProperty({ type: [ErrorDetail], required: false })
  details?: ErrorDetail[];

  @ApiProperty()
  requestId!: string;
}
