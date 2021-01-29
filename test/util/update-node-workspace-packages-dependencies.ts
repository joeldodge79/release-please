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

import {updateNodeWorkspacePackagesDependencies} from '../../src/util/update-node-workspace-packages-dependencies';
import {describe, it} from 'mocha';
import {expect} from 'chai';

describe('updateNodeWorkspacePackagesDependencies', () => {
  it('updates package dependencies', async () => {
    const rootPkgNewVersion = '1.2.3';
    const rootPkgPreviousVersion = '1.2.2';
    const dependsOnPkg1NewVersion = '1.1.1';
    const dependsOnPkg1PreviousVersion = '1.1.0';
    const dependsOnPkg2NewVersion = '2.2.2';
    const dependsOnPkg2PreviousVersion = '2.2.0';
    const packages = {
      'packages/leafDependsOnMultiple': {
        name: '@workspace/leafDependsOnMultiple',
        version: '3.2.2',
        dependencies: {
          '@workspace/rootPkg': `^${rootPkgPreviousVersion}`,
          '@workspace/dependsOnPkg1': `^${dependsOnPkg1PreviousVersion}`,
          '@workspace/dependsOnPkg2': `^${dependsOnPkg2PreviousVersion}`,
          '@something/external': '^6.2.7',
        },
      },
      'packages/rootPkg': {
        name: '@workspace/rootPkg',
        version: rootPkgNewVersion,
        dependencies: {'@something/elseExternal': '^4.1.7'},
      },
      'packages/dependsOnPkg1': {
        name: '@workspace/dependsOnPkg1',
        version: dependsOnPkg1NewVersion,
        dependencies: {
          '@workspace/rootPkg': `^${rootPkgPreviousVersion}`,
          someExternal: '^9.2.3',
        },
      },
      'packages/dependsOnPkg2': {
        name: '@workspace/dependsOnPkg2',
        version: dependsOnPkg2NewVersion,
        dependencies: {
          '@workspace/dependsOnPkg1': `^${dependsOnPkg1PreviousVersion}`,
          anotherExternal: '^4.3.1',
        },
      },
    };
    const actual = await updateNodeWorkspacePackagesDependencies(packages);
    const expected = {
      'packages/leafDependsOnMultiple': {
        name: '@workspace/leafDependsOnMultiple',
        version: '3.2.2',
        dependencies: {
          '@workspace/rootPkg': `^${rootPkgNewVersion}`,
          '@workspace/dependsOnPkg1': `^${dependsOnPkg1NewVersion}`,
          '@workspace/dependsOnPkg2': `^${dependsOnPkg2NewVersion}`,
          '@something/external': '^6.2.7',
        },
      },
      'packages/rootPkg': {
        name: '@workspace/rootPkg',
        version: rootPkgNewVersion,
        dependencies: {'@something/elseExternal': '^4.1.7'},
      },
      'packages/dependsOnPkg1': {
        name: '@workspace/dependsOnPkg1',
        version: dependsOnPkg1NewVersion,
        dependencies: {
          '@workspace/rootPkg': `^${rootPkgNewVersion}`,
          someExternal: '^9.2.3',
        },
      },
      'packages/dependsOnPkg2': {
        name: '@workspace/dependsOnPkg2',
        version: dependsOnPkg2NewVersion,
        dependencies: {
          '@workspace/dependsOnPkg1': `^${dependsOnPkg1NewVersion}`,
          anotherExternal: '^4.3.1',
        },
      },
    };
    expect(actual).to.eql(expected);
  });
});
