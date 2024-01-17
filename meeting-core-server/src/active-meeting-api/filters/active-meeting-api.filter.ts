import { Catch, ExceptionFilter } from '@nestjs/common';
import { Observable, of } from 'rxjs';
import { ErrorResponse } from '../../generated/error';

@Catch()
export class ActiveMeetingApiExceptionFilter implements ExceptionFilter {
  catch(exception: any): Observable<{error: ErrorResponse}> {
    return of( {
      error: {
        // TODO: after JIG-12532 use Status.UNKNOWN from grpc-js library
        code: 2,
        message: exception?.message || 'Unknown error'
      }
    });
  }
}
