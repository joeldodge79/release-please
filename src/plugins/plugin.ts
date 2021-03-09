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

import {ManifestPackageWithPRData} from '..';
import {VersionsMap} from '../updaters/update';
import {GitHub} from '../github';
import {Config} from '../manifest';

export abstract class ManifestPlugin {
  gh: GitHub;
  config: Config;
  constructor(github: GitHub, config: Config) {
    this.gh = github;
    this.config = config;
  }
  /**
   * @param newManifestVersions - new package versions set by releasers and any
   *   previous plugins
   * @param pkgsWithPRData -
   * @returns {PathPackages} - package.json contents with updated version and
   */
  abstract run(
    newManifestVersions: VersionsMap,
    pkgsWithPRData: ManifestPackageWithPRData[]
  ): Promise<[VersionsMap, ManifestPackageWithPRData[]]>;
}