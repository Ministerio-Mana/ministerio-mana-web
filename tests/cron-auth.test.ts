import assert from 'node:assert/strict';
import test from 'node:test';
import { isCronRequestAuthorized, safeSecretEqual } from '../src/lib/cronAuth.ts';

const SECRET = 'cron-secret-with-enough-entropy';

test('compara secretos sin aceptar valores parciales o de longitud distinta', () => {
  assert.equal(safeSecretEqual(SECRET, SECRET), true);
  assert.equal(safeSecretEqual(`${SECRET}x`, SECRET), false);
  assert.equal(safeSecretEqual('cron-secret', SECRET), false);
});

test('acepta encabezado de cron o Bearer y rechaza credenciales incorrectas', () => {
  const headerRequest = new Request('https://example.test/api/run', {
    headers: { 'x-cron-secret': SECRET },
  });
  const bearerRequest = new Request('https://example.test/api/run', {
    headers: { authorization: `bearer ${SECRET}` },
  });
  const invalidRequest = new Request('https://example.test/api/run', {
    headers: { authorization: 'Bearer incorrecto' },
  });
  const options = { secrets: [SECRET], production: true };

  assert.equal(isCronRequestAuthorized(headerRequest, options), true);
  assert.equal(isCronRequestAuthorized(bearerRequest, options), true);
  assert.equal(isCronRequestAuthorized(invalidRequest, options), false);
});

test('producción falla cerrada y nunca acepta el secreto en la URL', () => {
  const request = new Request(`https://example.test/api/run?token=${SECRET}`);
  assert.equal(isCronRequestAuthorized(request, {
    secrets: [],
    production: true,
  }), false);
  assert.equal(isCronRequestAuthorized(request, {
    secrets: [SECRET],
    production: true,
    allowQueryTokenInDevelopment: true,
  }), false);
});

test('desarrollo puede operar sin secreto o usar token solo cuando se habilita', () => {
  const plainRequest = new Request('http://localhost:4321/api/run');
  const tokenRequest = new Request(`http://localhost:4321/api/run?token=${SECRET}`);
  assert.equal(isCronRequestAuthorized(plainRequest, {
    secrets: [],
    production: false,
  }), true);
  assert.equal(isCronRequestAuthorized(plainRequest, {
    secrets: [],
    production: false,
    allowWithoutSecretInDevelopment: false,
  }), false);
  assert.equal(isCronRequestAuthorized(tokenRequest, {
    secrets: [SECRET],
    production: false,
    allowQueryTokenInDevelopment: true,
  }), true);
});
