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

import NodeWorkspaceDependencyUpdates from '../../src/plugins/node-workspace';
import {describe, it, afterEach} from 'mocha';
import * as chai from 'chai';
import * as sinon from 'sinon';
import {GitHub} from '../../src/github';
import {Config} from '../../src/manifest';
import {buildGitHubFileRaw} from '../releasers/utils';
import {ManifestPackageWithPRData} from '../../src';
import * as chaiBetter from 'chai-better-shallow-deep-equal';
import {packageJsonStringify} from '../../src/util/package-json-stringify';
chai.use(chaiBetter);
const expect = chai.expect;

const sandbox = sinon.createSandbox();

describe('NodeWorkspaceDependencyUpdates', () => {
  afterEach(() => {
    sandbox.restore();
  });

  function mockGithub(github: GitHub) {
    return sandbox.mock(github);
  }

  function expectGetFiles(
    mock: sinon.SinonMock,
    namesContents: [string, string][]
  ) {
    for (const [file, contents] of namesContents) {
      mock
        .expects('getFileContentsOnBranch')
        .withExactArgs(file, 'main')
        .once()
        .resolves(buildGitHubFileRaw(contents));
    }
  }

  describe('run', () => {
    it('simple chain: root pkg update bumps dependents', async () => {
      const github = new GitHub({
        owner: 'fake',
        repo: 'repo',
        defaultBranch: 'main',
      });
      const mock = mockGithub(github);
      expectGetFiles(mock, [
        [
          'packages/pkgB/package.json',
          JSON.stringify({
            name: '@here/pkgB',
            version: '2.2.2',
            dependencies: {
              '@here/pkgA': '^1.1.1',
              someExternal: '^9.2.3',
            },
          }),
        ],
        [
          'packages/pkgC/package.json',
          JSON.stringify({
            name: '@here/pkgC',
            version: '3.3.3',
            dependencies: {
              '@here/pkgB': '^2.2.2',
              anotherExternal: '^4.3.1',
            },
          }),
        ],
      ]);
      const config: Config = {
        packages: {
          'packages/pkgA': {},
          'packages/pkgB': {},
          'packages/pkgC': {},
        },
        parsedPackages: [
          {path: 'packages/pkgA', releaseType: 'node'},
          {path: 'packages/pkgB', releaseType: 'node'},
          {path: 'packages/pkgC', releaseType: 'node'},
        ],
      };

      // pkgA had a patch bump from manifest.runReleasers()
      const newManifestVersions = new Map([['packages/pkgA', '1.1.2']]);
      const pkgsWithPRData: ManifestPackageWithPRData[] = [
        {
          config: {
            releaseType: 'node',
            path: 'packages/pkgA',
          },
          prData: {
            version: '1.1.2',
            changes: new Map([
              [
                'packages/pkgA/package.json',
                {
                  content: packageJsonStringify({
                    name: '@here/pkgA',
                    version: '1.1.2',
                    dependencies: {'@there/foo': '^4.1.7'},
                  }),
                  mode: '100644',
                },
              ],
            ]),
          },
        },
      ];

      const nodeWS = new NodeWorkspaceDependencyUpdates(github, config);
      const [actualManifest, actualChanges] = await nodeWS.run(
        newManifestVersions,
        pkgsWithPRData
      );
      mock.verify();

      expect([...actualManifest]).to.eql([
        ['packages/pkgA', '1.1.2'],
        ['packages/pkgB', '2.2.3'],
        ['packages/pkgC', '3.3.4'],
      ]);
      expect(actualChanges).to.shallowDeepEqual([
        {
          config: {
            releaseType: 'node',
            path: 'packages/pkgA',
          },
          prData: {
            version: '1.1.2',
            changes: new Map([
              [
                'packages/pkgA/package.json',
                {
                  content: packageJsonStringify({
                    name: '@here/pkgA',
                    version: '1.1.2',
                    dependencies: {'@there/foo': '^4.1.7'},
                  }),
                  mode: '100644',
                },
              ],
            ]),
          },
        },
        {
          config: {
            releaseType: 'node',
            path: 'packages/pkgB',
          },
          prData: {
            version: '2.2.3',
            changes: new Map([
              [
                'packages/pkgB/package.json',
                {
                  content: packageJsonStringify({
                    name: '@here/pkgB',
                    version: '2.2.3',
                    dependencies: {
                      '@here/pkgA': '^1.1.2',
                      someExternal: '^9.2.3',
                    },
                  }),
                  mode: '100644',
                },
              ],
            ]),
          },
        },
        {
          config: {
            releaseType: 'node',
            path: 'packages/pkgC',
          },
          prData: {
            version: '3.3.4',
            changes: new Map([
              [
                'packages/pkgC/package.json',
                {
                  content: packageJsonStringify({
                    name: '@here/pkgC',
                    version: '3.3.4',
                    dependencies: {
                      '@here/pkgB': '^2.2.3',
                      anotherExternal: '^4.3.1',
                    },
                  }),
                  mode: '100644',
                },
              ],
            ]),
          },
        },
      ]);
      /*
      const expected = [
        pkgAUpdate,
        // pkgB patch bump due to dependency on pkgA
        [
          'packages/pkgB',
          {
            name: '@here/pkgB',
            version: '2.2.3',
            dependencies: {
              '@here/pkgA': '^1.1.2',
              someExternal: '^9.2.3',
            },
          },
        ],
        // pkgC patch bump due to dependency on pkgB
        [
          'packages/pkgC',
          {
            name: '@here/pkgC',
            version: '3.3.4',
            dependencies: {
              '@here/pkgB': '^2.2.3',
              anotherExternal: '^4.3.1',
            },
          },
        ],
      ];
      expect(actual).to.eql(expected);
      */
    });

    /*
    it('triangle: root + one leg updates bumps other leg', async () => {
      // pkgA had a patch bump from release-please
      const pkgAUpdate: [string, PackageJson] = [
        'packages/pkgA',
        {
          name: '@here/pkgA',
          // pkgA had a patch bump
          version: '1.1.2',
          dependencies: {'@there/foo': '^4.1.7'},
        },
      ];
      const pkgBUpdate: [string, PackageJson] = [
        'packages/pkgB',
        {
          name: '@here/pkgB',
          // pkgB had a minor bump
          version: '2.3.0',
          dependencies: {
            '@here/pkgA': '^1.1.1',
            someExternal: '^9.2.3',
          },
        },
      ];
      const packagesUpdatesFromManifestRun = new Map([pkgAUpdate, pkgBUpdate]);
      const allPackages = new Map([
        pkgAUpdate,
        pkgBUpdate,
        // no release-please bump for C
        [
          'packages/pkgC',
          {
            name: '@here/pkgC',
            version: '3.3.3',
            dependencies: {
              '@here/pkgA': '^1.1.1',
              '@here/pkgB': '^2.2.2',
              anotherExternal: '^4.3.1',
            },
          },
        ],
      ]);
      const expected = [
        pkgAUpdate,
        [
          'packages/pkgB',
          {
            name: '@here/pkgB',
            // from release-please
            version: '2.3.0',
            dependencies: {
              // updated spec
              '@here/pkgA': '^1.1.2',
              someExternal: '^9.2.3',
            },
          },
        ],
        // pkgC patch bump due to pkg[AB] bumps
        [
          'packages/pkgC',
          {
            name: '@here/pkgC',
            // only a patch bump inspite of B's minor bump
            version: '3.3.4',
            dependencies: {
              '@here/pkgA': '^1.1.2',
              '@here/pkgB': '^2.3.0',
              anotherExternal: '^4.3.1',
            },
          },
        ],
      ];
      const updates = await updateNodeWorkspacePackagesDependencies(
        packagesUpdatesFromManifestRun,
        allPackages
      );
      const actual = [...updates];
      expect(actual).to.eql(expected);
    });

    it('discontinguous graph', async () => {
      const pkgAUpdate: [string, PackageJson] = [
        'packages/pkgA',
        {
          name: '@here/pkgA',
          // patch bump from release-please
          version: '1.1.2',
          dependencies: {'@there/foo': '^4.1.7'},
        },
      ];
      const pkgAAUpdate: [string, PackageJson] = [
        'packages/pkgAA',
        {
          name: '@here/pkgAA',
          // minor bump from release-please
          version: '11.2.0',
          dependencies: {'@there/foo': '^4.1.7'},
        },
      ];
      const packagesUpdatesFromManifestRun = new Map([pkgAUpdate, pkgAAUpdate]);
      const allPackages = new Map([
        pkgAUpdate,
        pkgAAUpdate,
        // no release-please bump for B
        [
          'packages/pkgB',
          {
            name: '@here/pkgB',
            version: '2.2.2',
            dependencies: {
              '@here/pkgA': '^1.1.1',
              someExternal: '^9.2.3',
            },
          },
        ],
        // no release-please bump for BB
        [
          'packages/pkgBB',
          {
            name: '@here/pkgBB',
            version: '22.2.2',
            dependencies: {
              '@here/pkgAA': '^11.1.1',
              someExternal: '^9.2.3',
            },
          },
        ],
      ]);
      const expected = [
        pkgAUpdate,
        pkgAAUpdate,
        [
          'packages/pkgB',
          {
            name: '@here/pkgB',
            // because pkgA bumped
            version: '2.2.3',
            dependencies: {
              // updated spec
              '@here/pkgA': '^1.1.2',
              someExternal: '^9.2.3',
            },
          },
        ],
        [
          'packages/pkgBB',
          {
            name: '@here/pkgBB',
            // because pkgAA bumped
            version: '22.2.3',
            dependencies: {
              // updated spec
              '@here/pkgAA': '^11.2.0',
              someExternal: '^9.2.3',
            },
          },
        ],
      ];
      const updates = await updateNodeWorkspacePackagesDependencies(
        packagesUpdatesFromManifestRun,
        allPackages
      );
      const actual = [...updates];
      expect(actual).to.eql(expected);
    });

    it('fails to update dependent with invalid version', async () => {
      // pkgA had a patch bump from release-please
      const pkgAUpdate: [string, PackageJson] = [
        'packages/pkgA',
        {
          name: '@here/pkgA',
          version: '1.1.2',
          dependencies: {'@there/foo': '^4.1.7'},
        },
      ];
      const packagesUpdatesFromManifestRun = new Map([pkgAUpdate]);
      const allPackages = new Map([
        pkgAUpdate,
        [
          'packages/pkgB',
          {
            name: '@here/pkgB',
            // invalid version
            version: 'not-a-version',
            dependencies: {
              '@here/pkgA': '^1.1.1',
              someExternal: '^9.2.3',
            },
          },
        ],
      ]);
      const expected = [pkgAUpdate]; // pkgB not present.
      const updates = await updateNodeWorkspacePackagesDependencies(
        packagesUpdatesFromManifestRun,
        allPackages
      );
      const actual = [...updates];
      expect(actual).to.eql(expected);
    });

    it('updates dependent from pre-release version', async () => {
      // pkgA had a patch bump from release-please
      const pkgAUpdate: [string, PackageJson] = [
        'packages/pkgA',
        {
          name: '@here/pkgA',
          version: '1.1.2',
          dependencies: {'@there/foo': '^4.1.7'},
        },
      ];
      const packagesUpdatesFromManifestRun = new Map([pkgAUpdate]);
      const allPackages = new Map([
        pkgAUpdate,
        [
          'packages/pkgB',
          {
            name: '@here/pkgB',
            version: '2.2.2',
            dependencies: {
              // manually set in prior release
              '@here/pkgA': '^1.1.2-alpha.0',
              someExternal: '^9.2.3',
            },
          },
        ],
      ]);
      const expected = [
        pkgAUpdate,
        [
          'packages/pkgB',
          {
            name: '@here/pkgB',
            version: '2.2.3',
            dependencies: {
              // updated now that pkgA as "promoted" to non-alpha
              '@here/pkgA': '^1.1.2',
              someExternal: '^9.2.3',
            },
          },
        ],
      ];
      const updates = await updateNodeWorkspacePackagesDependencies(
        packagesUpdatesFromManifestRun,
        allPackages
      );
      const actual = [...updates];
      expect(actual).to.eql(expected);
    });

    it('does not update dependent to pre-release version', async () => {
      // pkgA had a version set ("release-as") from release-please
      const pkgAUpdate: [string, PackageJson] = [
        'packages/pkgA',
        {
          name: '@here/pkgA',
          version: '1.2.0-alpha.0',
          dependencies: {'@there/foo': '^4.1.7'},
        },
      ];
      const packagesUpdatesFromManifestRun = new Map([pkgAUpdate]);
      const allPackages = new Map([
        pkgAUpdate,
        [
          'packages/pkgB',
          {
            name: '@here/pkgB',
            version: '2.2.2',
            dependencies: {
              '@here/pkgA': '^1.1.1',
              someExternal: '^9.2.3',
            },
          },
        ],
      ]);
      const expected = [pkgAUpdate]; // pkgB missing
      const updates = await updateNodeWorkspacePackagesDependencies(
        packagesUpdatesFromManifestRun,
        allPackages
      );
      const actual = [...updates];
      expect(actual).to.eql(expected);
    });
    */
  });
});
