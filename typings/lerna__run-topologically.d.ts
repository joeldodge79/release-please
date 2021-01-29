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

declare module '@lerna/run-topologically' {
  namespace runTopologically {
    // This is necessary, or TS will consider this to be a "non-module entity"
  }

  import Package = require('@lerna/package');
  interface Options {
    concurrency: number;
    graphType: 'allDependencies' | 'dependencies';
    rejectCycles: boolean;
  }
  function runTopologically(
    packages: Package[],
    runner: (pkg: Package) => Promise<Package>,
    opts: Options
  ): Promise<Package[]>;

  export = runTopologically;
}
