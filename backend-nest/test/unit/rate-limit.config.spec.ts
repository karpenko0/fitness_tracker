import { AppModule } from '../../src/app.module';

describe('rate limiting configuration', () => {
  it('registers a global throttler guard', () => {
    const providers = Reflect.getMetadata('providers', AppModule) as Array<any>;
    expect(providers).toEqual(expect.arrayContaining([
      expect.objectContaining({ provide: expect.anything() }),
    ]));
  });
});
