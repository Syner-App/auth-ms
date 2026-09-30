import { ArgumentsHost, Catch } from '@nestjs/common';
import { BaseRpcExceptionFilter, RpcException } from '@nestjs/microservices';
import { status } from '@grpc/grpc-js';

const DUPLICATE_KEY = 11000;

interface MongoDuplicateKeyError {
  code: typeof DUPLICATE_KEY;
  keyPattern?: Record<string, unknown>;
}

// Prisma 8's MongoDB connector surfaces driver errors (MongoServerError) as-is.
// Detected by shape, not instanceof: pnpm may install more than one copy of `mongodb`
const isDuplicateKeyError = (exception: unknown): exception is MongoDuplicateKeyError =>
  typeof exception === 'object' &&
  exception !== null &&
  (exception as MongoDuplicateKeyError).code === DUPLICATE_KEY;

@Catch()
export class MongoExceptionFilter extends BaseRpcExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    if (isDuplicateKeyError(exception)) {
      const fields = Object.keys(exception.keyPattern ?? {});
      return super.catch(
        new RpcException({
          code: status.ALREADY_EXISTS,
          message: `Record with the same ${fields.join(', ') || 'unique field'} already exists`,
        }),
        host,
      );
    }
    return super.catch(exception, host);
  }
}
