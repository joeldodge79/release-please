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

import * as semver from 'semver';
import cu = require('@lerna/collect-updates');
import Package = require('@lerna/package');
import {PackageJson} from '@lerna/package';
import PackageGraph = require('@lerna/package-graph');
import runTopologically = require('@lerna/run-topologically');
import {ManifestPlugin} from './plugin';
import {ManifestPackageWithPRData} from '..';
import {VersionsMap} from '../updaters/update';
import {packageJsonStringify} from '../util/package-json-stringify';

export type PathPkgJson = Map<string, PackageJson>;

export default class NodeWorkspaceDependencyUpdates extends ManifestPlugin {
  // package.json contents already updated by the node releasers.
  private filterPackages(
    pkgsWithPRData: ManifestPackageWithPRData[]
  ): PathPkgJson {
    const pathPkgs = new Map();
    for (const pkg of pkgsWithPRData) {
      if (pkg.config.releaseType === 'node') {
        for (const [path, fileData] of pkg.prData.changes) {
          if (path === `${pkg.config.path}/package.json`) {
            pathPkgs.set(path, JSON.parse(fileData.content!) as PackageJson);
          }
        }
      }
    }
    return pathPkgs;
  }

  // all packages' package.json content - both updated by this run as well as
  // those that did not update (no user facing commits).
  private async getAllWorkspacePackages(
    rpUpdatedPkgs: PathPkgJson
  ): Promise<[string, PackageJson][]> {
    const nodePkgs: [string, PackageJson][] = [];
    for (const pkg of this.config.parsedPackages) {
      if (pkg.releaseType !== 'node') {
        continue;
      }
      const path = `${pkg.path}/package.json`;
      let contents: PackageJson;
      const alreadyUpdated = rpUpdatedPkgs.get(path);
      if (alreadyUpdated) {
        contents = alreadyUpdated;
      } else {
        const fileContents = await this.gh.getFileContents(path);
        contents = JSON.parse(fileContents.parsedContent);
      }
      nodePkgs.push([path, contents]);
    }
    return nodePkgs;
  }

  private async runLernaVersion(
    rpUpdatedPkgs: PathPkgJson,
    allPkgs: [string, PackageJson][]
  ): Promise<Map<string, Package>> {
    // Build the graph of all the packages: similar to https://git.io/Jqf1v
    const packageGraph = new PackageGraph(
      allPkgs.map(([path, pkgJson]) => new Package(pkgJson, path)),
      'allDependencies'
    );

    // release-please already did the work of @lerna/collectUpdates (identifying
    // which packages need version bumps based on conventional commits). We use
    // that as our `isCandidate` callback in @lerna/collectUpdates.collectPackages.
    // similar to https://git.io/JqUOB
    // `collectPackages` includes "localDependents" of our release-please updated
    // packages as they need to be patch bumped.
    const updatesWithDependents = cu.collectPackages(packageGraph, {
      isCandidate: node => rpUpdatedPkgs.has(node.location),
    });

    // our implementation of producing a Map<pkgName, newVersion> similar to
    // `this.updatesVersions` which is used to set updated package
    // (https://git.io/JqfD7) and dependency (https://git.io/JqU3q) versions
    //
    // `lerna version` accomplishes this with:
    // `getVersionsForUpdates` (https://git.io/JqfyI)
    //   -> `getVersion` + `reduceVersions` (https://git.io/JqfDI)
    const updatesVersions = new Map();
    const invalidVersions = new Set();
    for (const node of updatesWithDependents) {
      let version: string;
      // release-please updated this version.
      if (rpUpdatedPkgs.has(node.location)) {
        version = node.version;
        // must be a dependent, assume a "patch" bump.
      } else {
        const patch = semver.inc(node.version, 'patch');
        if (patch === null) {
          console.log(
            `Don't know how to patch ${node.name}'s version(${node.version})`
          );
          invalidVersions.add(node.name);
          continue;
        }
        version = patch;
      }
      updatesVersions.set(node.name, version);
    }

    // our implementation of a subset of `updatePackageVersions` to produce a
    // callback for updating versions and dependencies (https://git.io/Jqfyu)
    const runner = async (pkg: Package): Promise<Package> => {
      pkg.set('version', updatesVersions.get(pkg.name));
      const graphPkg = packageGraph.get(pkg.name);
      for (const [depName, resolved] of graphPkg.localDependencies) {
        const depVersion = updatesVersions.get(depName);
        if (depVersion && resolved.type !== 'directory') {
          pkg.updateLocalDependency(resolved, depVersion, '^');
        }
      }
      return pkg;
    };

    // https://git.io/Jqfyp
    const allUpdated = await runTopologically(
      updatesWithDependents
        .filter(node => !invalidVersions.has(node.name))
        .map(node => node.pkg),
      runner,
      {
        graphType: 'allDependencies',
        concurrency: 1,
        rejectCycles: false,
      }
    );
    return new Map(allUpdated.map(p => [p.location, p]));
  }

  private updatePkgsWithPRData(
    pkgsWithPRData: ManifestPackageWithPRData[],
    newManifestVersions: VersionsMap,
    allUpdated: Map<string, Package>
  ) {
    for (const pkg of pkgsWithPRData) {
      if (pkg.config.releaseType !== 'node') {
        continue;
      }
      const pkgPath = pkg.config.path;
      const filePath = `${pkgPath}/package.json`;
      const updated = allUpdated.get(filePath);
      if (!updated) {
        continue;
      }
      const content = packageJsonStringify(updated.toJSON());
      const fileData = pkg.prData.changes.get(filePath) ?? {
        content,
        mode: '100644',
      };
      pkg.prData.changes.set(filePath, fileData);
      newManifestVersions.set(pkgPath, updated.version);
      allUpdated.delete(filePath);
    }
    for (const [filePath, update] of allUpdated) {
      const pkg = this.config.parsedPackages.find(
        p => `${p.path}/package.json` === filePath
      );
      if (!pkg) {
        //TODO: pass in checkpoint and warn about update to non-workspace pkg
        continue;
      }
      pkg.packageName = update.name;
      const content = packageJsonStringify(update.toJSON());
      pkgsWithPRData.push({
        config: pkg,
        prData: {
          version: update.version,
          changes: new Map([[filePath, {content, mode: '100644'}]]),
        },
      });
      newManifestVersions.set(
        filePath.replace(/\/package.json$/, ''),
        update.version
      );
    }
  }

  /**
   * Update node monorepo workspace package dependencies.
   * Inspired by and using a subset of the logic from `lerna version`
   */
  async run(
    newManifestVersions: VersionsMap,
    pkgsWithPRData: ManifestPackageWithPRData[]
  ): Promise<[VersionsMap, ManifestPackageWithPRData[]]> {
    const rpUpdatedPkgs = this.filterPackages(pkgsWithPRData);
    const allPkgs = await this.getAllWorkspacePackages(rpUpdatedPkgs);
    const allUpdated = await this.runLernaVersion(rpUpdatedPkgs, allPkgs);
    this.updatePkgsWithPRData(pkgsWithPRData, newManifestVersions, allUpdated);

    return [newManifestVersions, pkgsWithPRData];
  }
}
