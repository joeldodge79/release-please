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

declare module '@lerna/package' {
  namespace Package {
    // This is necessary, or TS will consider this to be a "non-module entity"
  }

  interface PackageJson {
    name: string;
    version: string;
    dependencies?: Record<string, string>;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    [key: string]: any;
  }

  import npa = require('npm-package-arg');

  /**
   * Sparse interface for Package only representing what we use.
   */
  class Package {
    location: string;
    name: string;
    constructor(pkg: PackageJson, location: string, rootPath?: string);

    ///////////////////////////////
    // Public API
    ///////////////////////////////

    /**
     * updates a local dependency
     */
    updateLocalDependency(
      resolved: npa.Result,
      depVersion: string,
      savePrefix: string
    ): void;

    toJSON(): PackageJson;
  }

  export = Package;
}
