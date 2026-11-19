import { describe, it, expect } from 'vitest';
import { hasChannelCredentials } from './channelSync';

describe('hasChannelCredentials', () => {
  it('rejects empty and missing credentials', () => {
    expect(hasChannelCredentials({ credentials: {} })).toBe(false);
    expect(hasChannelCredentials({ credentials: null as any })).toBe(false);
    expect(hasChannelCredentials({ credentials: { api_key: '' } })).toBe(false);
    expect(hasChannelCredentials({ credentials: { api_key: '   ' } })).toBe(false);
  });

  it('rejects seed placeholder credentials so demo channels stay simulated', () => {
    expect(hasChannelCredentials({ credentials: { api_key: 'placeholder_api_key' } })).toBe(false);
    expect(hasChannelCredentials({ credentials: { token: 'placeholder' } })).toBe(false);
    expect(hasChannelCredentials({ credentials: { username: 'placeholder_user', password: 'placeholder_pass' } })).toBe(false);
  });

  it('accepts real bearer-style credentials', () => {
    expect(hasChannelCredentials({ credentials: { api_key: 'bk_live_abc123' } })).toBe(true);
    expect(hasChannelCredentials({ credentials: { token: 'tok_xyz' } })).toBe(true);
    expect(hasChannelCredentials({ credentials: { access_token: 'at_xyz' } })).toBe(true);
  });

  it('accepts basic auth only when both username and password exist', () => {
    expect(hasChannelCredentials({ credentials: { username: 'u' } })).toBe(false);
    expect(hasChannelCredentials({ credentials: { password: 'p' } })).toBe(false);
    expect(hasChannelCredentials({ credentials: { username: 'u', password: 'p' } })).toBe(true);
  });

  it('accepts custom header credentials', () => {
    expect(hasChannelCredentials({ credentials: { headers: { 'X-Api-Key': 'k' } } })).toBe(true);
    expect(hasChannelCredentials({ credentials: { headers: {} } })).toBe(false);
  });
});
