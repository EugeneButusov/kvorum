import Redis from 'ioredis';

// lazyConnect is mandatory: generate-openapi.ts and AppModule-boot unit tests construct this module
// with REDIS_URL set but no Redis listening. Connecting on construction would error/hang those
// paths; instead the socket opens on the first command. Mirrors the rate-limiter client.
export function createSessionRedis(redisUrl: string): Redis {
  const redis = new Redis(redisUrl, {
    lazyConnect: true,
    maxRetriesPerRequest: 3,
    retryStrategy: (times) => Math.min(times * 200, 2000),
  });

  redis.on('error', () => {
    // Attached to avoid unhandled ioredis errors during outages; the SessionStore surfaces
    // unavailability to callers, which the guard maps to 503.
  });

  return redis;
}
