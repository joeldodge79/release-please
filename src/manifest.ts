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

import {CommitSplit} from './commit-split';
import {GitHub, GitHubFileContents, ReleaseCreateResponse} from './github';
import {Update, VersionsMap} from './updaters/update';
import {ReleaseType} from './releasers';
import {Commit} from './graphql-to-commits';
import {
  RELEASE_PLEASE,
  DEFAULT_LABELS,
  RELEASE_PLEASE_CONFIG,
  RELEASE_PLEASE_MANIFEST,
} from './constants';
import {BranchName} from './util/branch-name';
import {
  factory,
  ManifestConstructorOptions,
  GitHubReleaseFactoryOptions,
} from '.';
import {ChangelogSection} from './conventional-commits';
import {ReleasePleaseManifest} from './updaters/release-please-manifest';
import {CheckpointType, checkpoint, Checkpoint} from './util/checkpoint';
import {
  GitHubRelease,
  GitHubReleaseResponse,
  GITHUB_RELEASE_LABEL,
} from './github-release';
import {OpenPROptions} from './release-pr';

interface ReleaserConfigJson {
  'release-type'?: ReleaseType;
  'bump-minor-pre-major'?: boolean;
  'changelog-sections'?: ChangelogSection[];
  'release-as'?: string;
  'release-draft'?: boolean;
}

interface ReleaserPackageConfig extends ReleaserConfigJson {
  'package-name'?: string;
  'changelog-path'?: string;
}

export interface Config extends ReleaserConfigJson {
  packages: Record<string, ReleaserPackageConfig>;
  parsedPackages: Package[];
  'bootstrap-sha'?: string;
}

interface Package {
  path: string;
  releaseType: ReleaseType;
  packageName?: string;
  bumpMinorPreMajor?: boolean;
  changelogSections?: ChangelogSection[];
  changelogPath?: string;
  releaseAs?: string;
  releaseDraft: boolean;
}

interface PackageReleaseData extends Package {
  releaserOptions: Omit<GitHubReleaseFactoryOptions, 'repoUrl'>;
  commits: Commit[];
  lastVersion?: string;
}

interface PackageWithPRData {
  name: string;
  openPROptions: OpenPROptions;
}

type ManifestJson = Record<string, string>;

export type ManifestGitHubReleaseResult =
  | Record<string, GitHubReleaseResponse | undefined>
  | undefined;

export class Manifest {
  gh: GitHub;
  configFileName: string;
  manifestFileName: string;
  checkpoint: Checkpoint;
  configFile?: Config;
  headManifest?: ManifestJson;

  constructor(options: ManifestConstructorOptions) {
    this.gh = options.github;
    this.configFileName = options.configFile || RELEASE_PLEASE_CONFIG;
    this.manifestFileName = options.manifestFile || RELEASE_PLEASE_MANIFEST;
    this.checkpoint = options.checkpoint || checkpoint;
  }

  protected async getBranchName() {
    return BranchName.ofTargetBranch(await this.gh.getDefaultBranch());
  }

  protected async getFileJson<T>(fileName: string): Promise<T>;
  protected async getFileJson<T>(
    fileName: string,
    sha: string
  ): Promise<T | undefined>;
  protected async getFileJson<T>(
    fileName: string,
    sha?: string
  ): Promise<T | undefined> {
    let content: GitHubFileContents;
    try {
      if (sha) {
        content = await this.gh.getFileContentsWithSimpleAPI(
          fileName,
          sha,
          false
        );
      } else {
        content = await this.gh.getFileContents(fileName);
      }
    } catch (e) {
      this.checkpoint(
        `Failed to get ${fileName} at ${sha ?? 'HEAD'}: ${e.status}`,
        CheckpointType.Failure
      );
      // If a sha is provided this is a request for the manifest file at the
      // last merged Release PR. The only reason it would not exist is if a user
      // checkedout that branch and deleted the manifest file right before
      // merging. There is no recovery from that so we'll fall back to using
      // the manifest at the tip of the defaultBranch.
      if (sha === undefined) {
        // !sha means this is a request against the tip of the defaultBranch and
        // we require that the manifest and config exist there. If they don't,
        // they can be added and this exception will not be thrown.
        throw e;
      }
      return;
    }
    return JSON.parse(content.parsedContent);
  }

  protected async getManifestJson(): Promise<ManifestJson>;
  protected async getManifestJson(
    sha: string
  ): Promise<ManifestJson | undefined>;
  protected async getManifestJson(
    sha?: string
  ): Promise<ManifestJson | undefined> {
    // cache headManifest since it's loaded in validate() as well as later on
    // and we never write to it.
    let manifest: ManifestJson | undefined;
    if (sha === undefined) {
      if (!this.headManifest) {
        this.headManifest = await this.getFileJson<ManifestJson>(
          this.manifestFileName
        );
      }
      manifest = this.headManifest;
    } else {
      manifest = await this.getFileJson<ManifestJson>(
        this.manifestFileName,
        sha
      );
    }
    return manifest;
  }

  protected async getManifestVersions(
    sha?: string
  ): Promise<[VersionsMap, string]>;
  protected async getManifestVersions(
    sha: false,
    newPaths: string[]
  ): Promise<VersionsMap>;
  protected async getManifestVersions(
    sha?: string | false,
    newPaths?: string[]
  ): Promise<[VersionsMap, string] | VersionsMap> {
    let manifestJson: object;
    const defaultBranch = await this.gh.getDefaultBranch();
    const bootstrapMsg =
      `Bootstrapping from ${this.manifestFileName} ` +
      `at tip of ${defaultBranch}`;
    if (sha === undefined) {
      this.checkpoint(bootstrapMsg, CheckpointType.Failure);
    }
    if (sha === false) {
      this.checkpoint(
        `${bootstrapMsg} for missing paths [${newPaths!.join(', ')}]`,
        CheckpointType.Failure
      );
    }
    let atSha = 'tip';
    if (!sha) {
      manifestJson = await this.getManifestJson();
    } else {
      // try to retrieve manifest from last release sha.
      const maybeManifestJson = await this.getManifestJson(sha);
      atSha = sha;
      if (maybeManifestJson === undefined) {
        // user deleted manifest from last release PR before merging.
        this.checkpoint(bootstrapMsg, CheckpointType.Failure);
        manifestJson = await this.getManifestJson();
        atSha = 'tip';
      } else {
        manifestJson = maybeManifestJson;
      }
    }
    const parsed: VersionsMap = new Map(Object.entries(manifestJson));
    if (sha === false) {
      return parsed;
    } else {
      return [parsed, atSha];
    }
  }

  protected async getConfigJson(): Promise<Config> {
    // cache config since it's loaded in validate() as well as later on and we
    // never write to it.
    if (!this.configFile) {
      const config = await this.getFileJson<Omit<Config, 'parsedPackages'>>(
        this.configFileName
      );
      const packages = [];
      for (const pkgPath in config.packages) {
        const pkgCfg = config.packages[pkgPath];
        const pkg = {
          path: pkgPath,
          releaseType:
            pkgCfg['release-type'] ?? config['release-type'] ?? 'node',
          packageName: pkgCfg['package-name'],
          bumpMinorPreMajor:
            pkgCfg['bump-minor-pre-major'] ?? config['bump-minor-pre-major'],
          changelogSections:
            pkgCfg['changelog-sections'] ?? config['changelog-sections'],
          changelogPath: pkgCfg['changelog-path'],
          releaseAs: this.resolveReleaseAs(
            pkgCfg['release-as'],
            config['release-as']
          ),
          releaseDraft: !!(pkgCfg['release-draft'] ?? config['release-draft']),
        };
        packages.push(pkg);
      }
      this.configFile = {parsedPackages: packages, ...config};
    }
    return this.configFile;
  }

  // Default release-as only considered if non-empty string.
  // Per-pkg release-as may be:
  //   1. undefined: use default release-as if present, otherwise normal version
  //      resolution (auto-increment from CC, fallback to defaultInitialVersion)
  //   1. non-empty string: use this version
  //   2. empty string: override default release-as if present, otherwise normal
  //      version resolution.
  private resolveReleaseAs(
    pkgRA?: string,
    defaultRA?: string
  ): string | undefined {
    let releaseAs: string | undefined;
    if (defaultRA) {
      releaseAs = defaultRA;
    }
    if (pkgRA !== undefined) {
      releaseAs = pkgRA;
    }
    if (!releaseAs) {
      releaseAs = undefined;
    }
    return releaseAs;
  }

  protected async getPackagesToRelease(
    commits: Commit[],
    sha?: string
  ): Promise<PackageReleaseData[]> {
    const packages = (await this.getConfigJson()).parsedPackages;
    const [manifestVersions, atSha] = await this.getManifestVersions(sha);
    const cs = new CommitSplit({
      includeEmpty: true,
      packagePaths: packages.map(p => p.path),
    });
    const commitsPerPath = cs.split(commits);
    const packagesToRelease: Record<string, PackageReleaseData> = {};
    const missingVersionPaths = [];
    const defaultBranch = await this.gh.getDefaultBranch();
    for (const pkg of packages) {
      const commits = commitsPerPath[pkg.path];
      if (!commits || commits.length === 0) {
        continue;
      }
      const lastVersion = manifestVersions.get(pkg.path);
      if (!lastVersion) {
        this.checkpoint(
          `Failed to find version for ${pkg.path} in ` +
            `${this.manifestFileName} at ${atSha} of ${defaultBranch}`,
          CheckpointType.Failure
        );
        missingVersionPaths.push(pkg.path);
      } else {
        this.checkpoint(
          `Found version ${lastVersion} for ${pkg.path} in ` +
            `${this.manifestFileName} at ${atSha} of ${defaultBranch}`,
          CheckpointType.Success
        );
      }
      const {releaseDraft, ...rest} = pkg;
      const releaserOptions = {
        monorepoTags: true,
        draft: releaseDraft,
        ...rest,
      };
      packagesToRelease[pkg.path] = {
        commits,
        lastVersion,
        releaserOptions,
        ...pkg,
      };
    }
    if (missingVersionPaths.length > 0) {
      const headManifestVersions = await this.getManifestVersions(
        false,
        missingVersionPaths
      );
      for (const missingVersionPath of missingVersionPaths) {
        const headVersion = headManifestVersions.get(missingVersionPath);
        if (headVersion === undefined) {
          this.checkpoint(
            `Failed to find version for ${missingVersionPath} in ` +
              `${this.manifestFileName} at tip of ${defaultBranch}`,
            CheckpointType.Failure
          );
        }
        packagesToRelease[missingVersionPath].lastVersion = headVersion;
      }
    }
    return Object.values(packagesToRelease);
  }

  private async validateJsonFile(
    getFileMethod: 'getConfigJson' | 'getManifestJson',
    fileName: string
  ): Promise<{valid: true; obj: object} | {valid: false; obj: undefined}> {
    let response:
      | {valid: true; obj: object}
      | {valid: false; obj: undefined} = {
      valid: false,
      obj: undefined,
    };
    try {
      const obj = await this[getFileMethod]();
      if (obj.constructor.name === 'Object') {
        response = {valid: true, obj: obj};
      }
    } catch (e) {
      let errMsg;
      if (e instanceof SyntaxError) {
        errMsg = `Invalid JSON in ${fileName}`;
      } else {
        errMsg = `Unable to ${getFileMethod}(${fileName}): ${e.message}`;
      }
      this.checkpoint(errMsg, CheckpointType.Failure);
    }
    return response;
  }

  protected async validate(): Promise<boolean> {
    const configValidation = await this.validateJsonFile(
      'getConfigJson',
      this.configFileName
    );
    let validConfig = false;
    if (configValidation.valid) {
      const obj = configValidation.obj as Config;
      validConfig = !!Object.keys(obj.packages ?? {}).length;
      if (!validConfig) {
        this.checkpoint(
          `No packages found: ${this.configFileName}`,
          CheckpointType.Failure
        );
      }
    }

    const manifestValidation = await this.validateJsonFile(
      'getManifestJson',
      this.manifestFileName
    );
    let validManifest = false;
    if (manifestValidation.valid) {
      validManifest = true;
      const versions: VersionsMap = new Map(
        Object.entries(manifestValidation.obj)
      );
      for (const [_, version] of versions) {
        if (typeof version !== 'string') {
          validManifest = false;
          this.checkpoint(
            `${this.manifestFileName} must only contain string values`,
            CheckpointType.Failure
          );
          break;
        }
      }
    }
    return validConfig && validManifest;
  }

  private async runReleasers(
    packages: PackageReleaseData[],
    sha?: string
  ): Promise<[VersionsMap, PackageWithPRData[]]> {
    const manifestUpdates: VersionsMap = new Map();
    const openPRPackages: PackageWithPRData[] = [];
    for (const pkg of packages) {
      const {releaseType, ...options} = pkg.releaserOptions;
      const releaserClass = factory.releasePRClass(releaseType);
      const releasePR = new releaserClass({github: this.gh, ...options});
      const pkgName = (await releasePR.getPackageName()).name;
      this.checkpoint(
        `Processing package: ${releaserClass.name}(${pkgName})`,
        CheckpointType.Success
      );
      if (pkg.lastVersion === undefined) {
        this.checkpoint(
          `Falling back to default version for ${
            releaserClass.name
          }(${pkgName}): ${releasePR.defaultInitialVersion()}`,
          CheckpointType.Failure
        );
      }
      const openPROptions = await releasePR.getOpenPROptions(
        pkg.commits,
        pkg.lastVersion
          ? {
              name: `v${pkg.lastVersion}`,
              sha: sha ?? 'beginning of time',
              version: pkg.lastVersion,
            }
          : undefined
      );
      if (openPROptions) {
        openPRPackages.push({name: releasePR.packageName, openPROptions});
        manifestUpdates.set(pkg.path, openPROptions.version);
      }
    }
    return [manifestUpdates, openPRPackages];
  }

  private async buildManifestPR(
    manifestUpdates: VersionsMap,
    openPRPackages: PackageWithPRData[]
  ): Promise<[string, Update[]]> {
    let body = ':robot: I have created a release \\*beep\\* \\*boop\\*';
    const updates: Update[] = [];
    for (const openPRPackage of openPRPackages) {
      body +=
        '\n\n---\n' +
        `${openPRPackage.name}: ${openPRPackage.openPROptions.version}\n` +
        `${openPRPackage.openPROptions.changelogEntry}`;
      updates.push(...openPRPackage.openPROptions.updates);
    }

    // TODO: `Update` interface to supply cached contents for use in
    // GitHub.getChangeSet processing could be simplified to just use a
    // string - no need for a full blown GitHubFileContents
    const manifestContents: GitHubFileContents = {
      sha: '',
      parsedContent: '',
      content: Buffer.from(
        JSON.stringify(await this.getManifestJson())
      ).toString('base64'),
    };
    updates.push(
      new ReleasePleaseManifest({
        changelogEntry: '',
        packageName: '',
        path: this.manifestFileName,
        version: '',
        versions: manifestUpdates,
        contents: manifestContents,
      })
    );
    body +=
      '\n\nThis PR was generated with [Release Please]' +
      `(https://github.com/googleapis/${RELEASE_PLEASE}). See [documentation]` +
      `(https://github.com/googleapis/${RELEASE_PLEASE}#${RELEASE_PLEASE}).`;
    return [body, updates];
  }

  private async commitsSinceSha(sha?: string): Promise<Commit[]> {
    let fromSha = sha;
    if (fromSha === undefined) {
      fromSha = (await this.getConfigJson())['bootstrap-sha'];
    }
    return this.gh.commitsSinceSha(fromSha);
  }

  async pullRequest(): Promise<number | undefined> {
    const valid = await this.validate();
    if (!valid) {
      return;
    }

    const branchName = (await this.getBranchName()).toString();
    const lastMergedPR = await this.gh.lastMergedPRByHeadBranch(branchName);
    const commits = await this.commitsSinceSha(lastMergedPR?.sha);
    const packages = await this.getPackagesToRelease(
      commits,
      lastMergedPR?.sha
    );
    const [manifestUpdates, openPRPackages] = await this.runReleasers(
      packages,
      lastMergedPR?.sha
    );
    if (openPRPackages.length === 0) {
      this.checkpoint(
        'No user facing changes to release',
        CheckpointType.Success
      );
      return;
    }

    const [body, updates] = await this.buildManifestPR(
      manifestUpdates,
      openPRPackages
    );
    const pr = await this.gh.openPR({
      branch: branchName,
      title: 'chore: release',
      body: body,
      updates,
      labels: DEFAULT_LABELS,
    });
    if (pr) {
      await this.gh.addLabels(DEFAULT_LABELS, pr);
    }
    return pr;
  }

  async githubRelease(): Promise<ManifestGitHubReleaseResult> {
    const valid = await this.validate();
    if (!valid) {
      return;
    }
    const branchName = (await this.getBranchName()).toString();
    const lastMergedPR = await this.gh.lastMergedPRByHeadBranch(branchName);
    if (lastMergedPR === undefined) {
      this.checkpoint(
        'Unable to find last merged Manifest PR for tagging',
        CheckpointType.Failure
      );
      return;
    }
    if (lastMergedPR.labels.includes(GITHUB_RELEASE_LABEL)) {
      this.checkpoint(
        'Releases already created for last merged release PR',
        CheckpointType.Success
      );
      return;
    }
    if (!lastMergedPR.labels.includes(DEFAULT_LABELS[0])) {
      this.checkpoint(
        `Warning: last merged PR(#${lastMergedPR.number}) is missing ` +
          `label "${DEFAULT_LABELS[0]}" but has not yet been ` +
          `labeled "${GITHUB_RELEASE_LABEL}". If PR(#${lastMergedPR.number}) ` +
          'is meant to be a release PR, please apply the ' +
          `label "${DEFAULT_LABELS[0]}".`,
        CheckpointType.Failure
      );
      return;
    }
    const packages = await this.getPackagesToRelease(
      // use the lastMergedPR.sha as a Commit: lastMergedPR.files will inform
      // getPackagesToRelease() what packages had changes (i.e. at least one
      // file under their path changed in the lastMergedPR such as
      // "packages/mypkg/package.json"). These are exactly the packages we want
      // to create releases/tags for.
      [{sha: lastMergedPR.sha, message: '', files: lastMergedPR.files}],
      lastMergedPR.sha
    );
    const releases: Record<string, GitHubReleaseResponse | undefined> = {};
    let allReleasesCreated = !!packages.length;
    for (const pkg of packages) {
      const {releaseType, draft, ...options} = pkg.releaserOptions;
      const releaserClass = factory.releasePRClass(releaseType);
      const releasePR = new releaserClass({github: this.gh, ...options});
      const pkgName = (await releasePR.getPackageName()).name;
      const pkgLogDisp = `${releaserClass.name}(${pkgName})`;
      if (!pkg.lastVersion) {
        // a user manually modified the manifest file on the release branch
        // right before merging it and deleted the entry for this pkg.
        this.checkpoint(
          `Unable to find last version for ${pkgLogDisp}.`,
          CheckpointType.Failure
        );
        releases[pkg.path] = undefined;
        continue;
      }
      this.checkpoint(
        'Creating release for ' + `${pkgLogDisp}@${pkg.lastVersion}`,
        CheckpointType.Success
      );
      const releaser = new GitHubRelease({
        github: this.gh,
        releasePR,
        draft,
      });
      let release: ReleaseCreateResponse | undefined;
      try {
        release = await releaser.createRelease(pkg.lastVersion, lastMergedPR);
      } catch (err) {
        // There is no transactional bulk create releases API. Previous runs
        // may have failed due to transient infrastructure problems part way
        // through creating releases. Here we skip any releases that were
        // already successfully created.
        //
        // Note about `draft` releases: The GitHub API Release unique key is
        // `tag_name`. However, if `draft` is true, no git tag is created. Thus
        // multiple `draft` releases can be created with the exact same inputs.
        // (It's a tad confusing because `tag_name` still comes back populated
        // in these calls but the tag doesn't actually exist).
        // A draft release can even be created with a `tag_name` referring to an
        // existing tag referenced by another release.
        // However, GitHub will prevent "publishing" any draft release that
        // would cause a duplicate tag to be created. release-please manifest
        // users specifying the "release-draft" option could run into this
        // duplicate releases scenario. It's easy enough to just delete the
        // duplicate draft entries in the UI (or API).
        if (err.status === 422 && err.errors?.length) {
          if (
            err.errors[0].code === 'already_exists' &&
            err.errors[0].field === 'tag_name'
          ) {
            this.checkpoint(
              `Release for ${pkgLogDisp}@${pkg.lastVersion} already exists`,
              CheckpointType.Success
            );
          }
        } else {
          // PR will not be tagged with GITHUB_RELEASE_LABEL so another run
          // can try again.
          allReleasesCreated = false;
          await this.gh.commentOnIssue(
            `:robot: Failed to create release for ${pkgName} :cloud:`,
            lastMergedPR.number
          );
          this.checkpoint(
            'Failed to create release for ' +
              `${pkgLogDisp}@${pkg.lastVersion}: ${err.message}`,
            CheckpointType.Failure
          );
        }
        releases[pkg.path] = undefined;
        continue;
      }
      if (release) {
        await this.gh.commentOnIssue(
          `:robot: Release for ${pkgName} is at ${release.html_url} :sunflower:`,
          lastMergedPR.number
        );
        releases[pkg.path] = releaser.releaseResponse({
          release,
          version: pkg.lastVersion,
          sha: lastMergedPR.sha,
          number: lastMergedPR.number,
        });
      }
    }
    if (allReleasesCreated) {
      await this.gh.addLabels([GITHUB_RELEASE_LABEL], lastMergedPR.number);
      await this.gh.removeLabels(DEFAULT_LABELS, lastMergedPR.number);
    }
    return releases;
  }
}
