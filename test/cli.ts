// Copyright 2021 Google LLC
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//      http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import * as assert from 'assert';
import {expect} from 'chai';
import {
  factory,
  ReleasePRRunResult,
  RunResult,
  ReleasePRMethod,
  GitHubReleaseRunResult,
  Method,
  GitHubReleaseMethod,
} from '../src/factory';
import {GitHubRelease} from '../src/github-release';
import {ReleasePR} from '../src/release-pr';
import {describe, it, afterEach} from 'mocha';
import * as sinon from 'sinon';

import {parser, handleError} from '../src/bin/release-please';
import {ParseCallback} from 'yargs';
import chalk = require('chalk');

const sandbox = sinon.createSandbox();

let instanceToRun: ReleasePR | GitHubRelease;

function callStub(
  instance: ReleasePR,
  method: ReleasePRMethod
): ReleasePRRunResult;
function callStub(
  instance: GitHubRelease,
  method: GitHubReleaseMethod
): GitHubReleaseRunResult;
function callStub(
  instance: ReleasePR | GitHubRelease,
  _method: Method
): RunResult {
  instanceToRun = instance;
  return Promise.resolve(undefined);
}

describe('CLI', () => {
  afterEach(() => {
    sandbox.restore();
  });
  describe('handleError', () => {
    it('handles an error', () => {
      const stack = 'bad\nmore\nbad';
      const err = {
        body: {a: 1},
        status: 404,
        message: 'bad',
        stack,
      };
      const logs: string[] = [];
      handleError.logger = ({
        error: (msg: string) => logs.push(msg),
      } as unknown) as Console;
      handleError.yargsArgs = {debug: true, _: ['foobar'], $0: 'mocha?'};
      handleError(err);
      expect(logs).to.eql([
        chalk.red('command foobar failed with status 404'),
        '---------',
        stack,
      ]);
    });
    it('needs yargs', () => {
      let err: Error;
      let caught = false;
      handleError.yargsArgs = undefined;
      try {
        handleError({message: '', stack: ''});
      } catch (e) {
        err = e;
        caught = true;
      }
      expect(caught).to.be.true;
      expect(err!.message).to.equal(
        'Set handleError.yargsArgs with a yargs.Arguments instance.'
      );
    });
  });
  describe('release-pr', () => {
    it('instantiates release PR based on command line arguments', () => {
      sandbox.replace(factory, 'call', callStub);
      parser.parse(
        'release-pr --repo-url=googleapis/release-please-cli --package-name=cli-package'
      );
      assert.ok(instanceToRun! instanceof ReleasePR);
      assert.strictEqual(instanceToRun.gh.owner, 'googleapis');
      assert.strictEqual(instanceToRun.gh.repo, 'release-please-cli');
      assert.strictEqual(instanceToRun.packageName, 'cli-package');
      // Defaults to Node.js release type:
      assert.strictEqual(instanceToRun.constructor.name, 'Node');
    });
    it('validates releaseType choices', done => {
      sandbox.stub(factory, 'call').resolves(undefined);
      const cmd =
        'release-pr ' +
        '--release-type=foobar ' +
        '--repo-url=googleapis/release-please-cli ' +
        '--package-name=cli-package';
      const choices = [
        'go',
        'go-yoshi',
        'java-bom',
        'java-yoshi',
        'node',
        'ocaml',
        'php-yoshi',
        'python',
        'ruby',
        'ruby-yoshi',
        'rust',
        'simple',
        'terraform-module',
        'helm',
      ];
      const parseCallback: ParseCallback = (err, _argv, _output) => {
        expect(err).to.be.an('Error');
        expect(err)
          .to.have.property('message')
          .to.equal(
            'Invalid values:\n  Argument: release-type, Given: "foobar", ' +
              'Choices: ' +
              choices.map(c => `"${c}"`).join(', ')
          );
        done();
      };
      parser.parse(cmd, parseCallback);
    });
  });
  describe('latest-tag', () => {
    it('instantiates release PR for latestTag', () => {
      sandbox.replace(factory, 'call', callStub);
      parser.parse(
        'latest-tag --repo-url=googleapis/release-please-cli --package-name=cli-package'
      );
      assert.ok(instanceToRun! instanceof ReleasePR);
      assert.strictEqual(instanceToRun.gh.owner, 'googleapis');
      assert.strictEqual(instanceToRun.gh.repo, 'release-please-cli');
      assert.strictEqual(instanceToRun.packageName, 'cli-package');
      // Defaults to Node.js release type:
      assert.strictEqual(instanceToRun.constructor.name, 'Node');
    });
  });
  describe('github-release', () => {
    it('instantiates a GitHub released based on command line arguments', async () => {
      sandbox.replace(factory, 'call', callStub);
      const pkgName = 'cli-package';
      const cmd =
        'github-release ' +
        '--repo-url=googleapis/release-please-cli ' +
        '--release-type=node ' +
        `--package-name=${pkgName}`;
      parser.parse(cmd);
      assert.ok(instanceToRun! instanceof GitHubRelease);
      assert.strictEqual(instanceToRun.gh.owner, 'googleapis');
      assert.strictEqual(instanceToRun.gh.repo, 'release-please-cli');
      assert.strictEqual(instanceToRun.changelogPath, 'CHANGELOG.md');

      const jsonPkg = `{"name": "${pkgName}"}`;
      sandbox.stub(instanceToRun.releasePR.gh, 'getFileContents').resolves({
        sha: 'abc123',
        content: Buffer.from(jsonPkg, 'utf8').toString('base64'),
        parsedContent: jsonPkg,
      });
      assert.strictEqual(
        (await instanceToRun.releasePR.getPackageName()).name,
        'cli-package'
      );
      // Defaults to Node.js release type:
      assert.strictEqual(instanceToRun.releasePR.constructor.name, 'Node');
    });
    it('instantiates a GitHub released without releaseType', async () => {
      sandbox.replace(factory, 'call', callStub);
      const cmd = 'github-release --repo-url=googleapis/release-please-cli ';
      parser.parse(cmd);
      assert.ok(instanceToRun! instanceof GitHubRelease);
      assert.strictEqual(instanceToRun.releasePR.constructor.name, 'ReleasePR');
      assert.strictEqual(
        (await instanceToRun.releasePR.getPackageName()).name,
        ''
      );
    });
  });
});
