// npm run local:<command> (docs/LOCAL_TESTING.md): setup | refresh [bitocard|udozo] | up | down | logs
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';

const envFile = '.env.docker';
const compose = (...args) => {
  const result = spawnSync('docker', ['compose', '-f', 'docker-compose.local.yml', '--env-file', envFile, ...args], { stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status ?? 1);
};
const values = () => Object.fromEntries(readFileSync(envFile, 'utf8').split(/\r?\n/).filter(line => /^[A-Z_]+=/.test(line)).map(line => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]));
const requireSetup = () => {
  if (!existsSync(envFile)) {
    console.error('Run "npm run local:setup" first.');
    process.exit(1);
  }
};

const [command = 'help', ...rest] = process.argv.slice(2);
switch (command) {
  case 'setup': {
    if (!existsSync(envFile)) copyFileSync('docker/local/local.env.example', envFile);
    const generated = {
      LOCAL_CRON_SECRET: () => randomBytes(32).toString('hex'),
      BITOCARD_STORE_SERVER_SECRET: () => randomBytes(32).toString('hex'),
      UDOZO_STORE_SERVER_SECRET: () => randomBytes(32).toString('hex'),
      BITOCARD_ENCRYPTION_KEY: () => randomBytes(32).toString('base64'),
      UDOZO_ENCRYPTION_KEY: () => randomBytes(32).toString('base64'),
    };
    let text = readFileSync(envFile, 'utf8');
    for (const [key, make] of Object.entries(generated)) text = text.replace(new RegExp(`^${key}=$`, 'm'), `${key}=${make()}`);
    writeFileSync(envFile, text);
    const env = values();
    console.log(`${envFile} is ready. Still to fill in by hand:`);
    if (!env.SOURCE_BITOCARD_DATABASE_URL) console.log('  SOURCE_BITOCARD_DATABASE_URL  the live BitoCard database address (copied from, read only)');
    if (!env.SOURCE_UDOZO_DATABASE_URL) console.log('  SOURCE_UDOZO_DATABASE_URL     the live Udozo database address (copied from, read only)');
    console.log('  BITOCARD_ENCRYPTION_KEY, UDOZO_ENCRYPTION_KEY: replace the generated ones with the live keys to read encrypted fields.');
    break;
  }
  case 'refresh': {
    requireSetup();
    const env = values();
    if (!env.SOURCE_BITOCARD_DATABASE_URL && !env.SOURCE_UDOZO_DATABASE_URL) {
      console.error(`Fill in SOURCE_BITOCARD_DATABASE_URL and/or SOURCE_UDOZO_DATABASE_URL in ${envFile} first.`);
      process.exit(1);
    }
    compose('up', '-d', '--wait', 'postgres');
    // The apps let go of the databases while they are replaced, then migrate the fresh copies as they start.
    spawnSync('docker', ['compose', '-f', 'docker-compose.local.yml', '--env-file', envFile, 'stop', 'apps'], { stdio: 'inherit' });
    compose('--profile', 'tools', 'run', '--rm', 'refresh', ...rest);
    console.log('Copied. Start (or restart) the apps with "npm run local:up".');
    break;
  }
  case 'up':
    requireSetup();
    compose('up', '-d', '--build');
    console.log([
      'Starting (the first build takes a while; "npm run local:logs" to follow it):',
      '  BitoCard  store http://localhost:3000  SHQ http://localhost:3004  admin http://localhost:3003',
      '            docs http://localhost:3002  legals http://localhost:3005  verify http://localhost:3006  API http://localhost:3001',
      '  Udozo     site http://localhost:3007  SHQ http://localhost:3011  admin http://localhost:3012',
      '            Connect http://localhost:3013  POS http://localhost:3014  API http://localhost:3010',
    ].join('\n'));
    break;
  case 'down':
    requireSetup();
    compose('down');
    break;
  case 'logs':
    requireSetup();
    compose('logs', '-f', '--tail', '200', 'apps', ...rest);
    break;
  default:
    console.log('npm run local:setup | local:refresh [bitocard|udozo] | local:up | local:down | local:logs');
}
