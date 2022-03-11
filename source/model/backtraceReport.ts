import { pseudoRandomBytes } from 'crypto';
import { APP_NAME, LANG, THREAD, VERSION } from '../const/application';
import { machineIdSync } from '../helpers/machineId';
import { readModule, readSystemAttributes } from '../helpers/moduleResolver';
import { readMemoryInformation, readProcessStatus } from '../helpers/processHelper';
import { currentTimestamp } from '../utils';
import { IBacktraceData } from './backtraceData';
import { BacktraceStackTrace } from './backtraceStackTrace';

/**
 * BacktraceReport describe current exception/message payload message to Backtrace
 */
export class BacktraceReport {
  public static machineId = machineIdSync(true);

  public set symbolication(symbolication: boolean) {
    this._symbolication = symbolication;
  }

  public set symbolicationMap(symbolMap: Array<{ file: string; uuid: string }>) {
    if (!symbolMap) {
      throw new Error('Symbolication map is undefined');
    }

    if (!Array.isArray(symbolMap)) {
      throw new TypeError('Invalid type of symbolication map');
    }
    const invalidValues = symbolMap.some((n) => !n.file || !n.uuid);
    if (invalidValues) {
      throw new TypeError('Symbolication map contains invalid values - missing file or uuid value');
    }
    this._symbolicationMap = symbolMap;
  }

  // reprot id
  public readonly uuid: string = this.generateUuid();
  // timestamp
  public readonly timestamp: number = currentTimestamp();
  // lang
  public readonly lang = LANG;
  // environment version
  public readonly langVersion = process.version;
  // Backtrace-ndoe name
  public readonly agent = APP_NAME;
  // Backtrace-node  version
  public readonly agentVersion = VERSION;
  // main thread name
  public readonly mainThread = THREAD;

  public classifiers: string[] = [];

  /**
   * @deprecated
   * Please use client.sendReport instead
   * BacktraceReport generated by library allows you to
   * automatically send reports to Backtrace via send method
   */
  public send?: (callback: (err?: Error) => void) => void;

  /**
   * @deprecated
   * Please use client.sendReport instead
   * BacktraceReport generated by library allows you to
   * automatically send reports to Backtrace via send method
   */
  public sendSync?: (callback: (err?: Error) => void) => void;

  /**
   * Thread information about current application
   */
  public stackTrace!: BacktraceStackTrace;

  private _symbolicationMap?: Array<{ file: string; uuid: string }>;

  private _symbolication = false;

  /**
   * Current report attributes
   */
  private attributes: { [index: string]: any } = {};

  /**
   * Backtrace complex objet
   */
  private annotations: { [index: string]: any } = {};

  /**
   * Calling module information
   */
  private _callingModule!: NodeRequire;

  private _callingModulePath!: string;

  private tabWidth: number = 8;
  private contextLineCount: number = 200;

  private err!: Error;
  /**
   * Create new BacktraceReport - report information that will collect information
   * for Backtrace.
   *
   * Possible existing scenarios:
   * arg1: error + arg2: attributes = all required
   * arg1: object, arg2: nothing
   *
   * @param err Error or message - content to report
   * @param attributes Report attributes dictionary
   * @param attachments Report attachments that Backtrace will send to API
   */
  constructor(
    private data: Error | string = '',
    private clientAttributes: { [index: string]: any } = {},
    private attachments: string[] = [],
  ) {
    if (!clientAttributes) {
      clientAttributes = {};
    }
    this.splitAttributesFromAnnotations(clientAttributes);
    if (!attachments) {
      attachments = [];
    }
    this.setError(data);
  }
  /**
   * Check if report contains exception information
   */
  public isExceptionTypeReport(): boolean {
    return this.detectReportType(this.data);
  }

  public getPayload(): Error | string {
    return this.data;
  }
  /**
   * Set error or message in BacktraceReport object
   * @param err Current error
   */
  public setError(err: Error | string): void {
    this.data = err;
    if (this.detectReportType(err)) {
      this.err = err;
      this.classifiers = [err.name];
    } else {
      this.err = new Error(err);
      this.classifiers = [];
    }
  }

  /**
   * @deprecated
   * Please don't use log method in new BacktraceReport object.
   */
  public log() {
    console.warn('log method is deprecated.');
  }

  /**
   * @deprecated
   * Please don't use trace method in new BacktraceReport object
   */
  public trace() {
    console.warn('trace method is deprecated.');
  }

  /**
   * Add new attributes to existing report attributes
   * @param attributes new report attributes object
   */
  public addObjectAttributes(attributes: { [index: string]: any }): void {
    this.clientAttributes = {
      ...this.clientAttributes,
      ...this.attributes,
      ...attributes,
    };
  }

  public addAttribute(key: string, value: any): void {
    this.clientAttributes[key] = value;
  }

  public addAnnotation(key: string, value: object): void {
    this.annotations[key] = value;
  }

  public getAttachments(): string[] {
    return this.attachments;
  }

  public async toJson(): Promise<IBacktraceData> {
    // why library should wait to retrieve source code data?
    // architecture decision require to pass additional parameters
    // not in constructor, but in additional method.
    await this.collectReportInformation();

    const result = {
      uuid: this.uuid,
      timestamp: this.timestamp,
      lang: this.lang,
      langVersion: this.langVersion,
      mainThread: this.mainThread,
      classifiers: this.classifiers,
      threads: { main: this.stackTrace.toJson() },
      agent: this.agent,
      agentVersion: this.agentVersion,
      annotations: this.annotations,
      attributes: this.attributes,
      sourceCode: this.stackTrace.getSourceCode(),
      symbolication_maps: this._symbolicationMap || this.stackTrace.symbolicationMaps,
    } as IBacktraceData;

    // when symbolication information exists, set symbolication to sourcemap.
    // we should check symbolicationMap and _symbolication boolean value and symbolication id from attributes
    // if any value exists, we should extend report object with 'sourcemap' property.
    if (this._symbolication || this.attributes['symbolication_id'] || this._symbolicationMap) {
      result.symbolication = 'sourcemap';
    }
    return result;
  }

  public setSourceCodeOptions(tabWidth: number, contextLineCount: number) {
    this.tabWidth = tabWidth;
    this.contextLineCount = contextLineCount;
  }

  /**
   * Include symbolication information based on stack trace analysis
   */
  private includeSymbolication(): boolean {
    return this._symbolication && !this.attributes['symbolication_id'] && !this._symbolicationMap;
  }

  private async collectReportInformation(): Promise<void> {
    // get stack trace to retrieve calling module information
    this.stackTrace = new BacktraceStackTrace(this.err as Error);
    this.stackTrace.setSourceCodeOptions(this.tabWidth, this.contextLineCount);
    await this.stackTrace.parseStackFrames(this.includeSymbolication());
    // retrieve calling module object
    if (!this.attributes.hasOwnProperty('application')) {
      [this._callingModule, this._callingModulePath] = readModule(this.stackTrace.getCallingModulePath());
    }

    // combine attributes
    this.attributes = {
      ...this.readBuiltInAttributes(),
      ...this.clientAttributes,
    };
    // combine annotations
    this.annotations = this.readAnnotation();
  }

  private readBuiltInAttributes(): object {
    return {
      ...readMemoryInformation(),
      ...readProcessStatus(),
      ...this.readAttributes(),
      ...this.readErrorAttributes(),
    };
  }

  private detectReportType(err: Error | string): err is Error {
    return err instanceof Error;
  }

  private generateUuid(): string {
    const bytes = pseudoRandomBytes(16);
    return (
      bytes.slice(0, 4).toString('hex') +
      '-' +
      bytes.slice(4, 6).toString('hex') +
      '-' +
      bytes.slice(6, 8).toString('hex') +
      '-' +
      bytes.slice(8, 10).toString('hex') +
      '-' +
      bytes.slice(10, 16).toString('hex')
    );
  }

  private readErrorAttributes(): object {
    if (!this.detectReportType(this.err)) {
      return {
        'error.message': this.err,
      };
    }
    this.classifiers = [this.err.name];
    return {
      'error.message': this.err.message,
    };
  }

  private readAttributes(): object {
    const result = readSystemAttributes();

    if (this._callingModule) {
      const { name, version, main, description, author } = (this._callingModule || {}) as any;
      result['name'] = name;
      result['version'] = version;
      result['main'] = main;
      result['description'] = description;
      result['author'] = typeof author === 'object' && author.name ? author.name : author;
    }
    return result;
  }

  private readAnnotation(): object {
    const result = {
      'Environment Variables': process.env,
      'Exec Arguments': process.execArgv,
    } as any;

    if (this.detectReportType(this.err)) {
      result['Exception'] = this.err;
    }
    return { ...result, ...this.annotations };
  }

  private splitAttributesFromAnnotations(clientAttributes: { [index: string]: any }) {
    for (const key in clientAttributes) {
      if (clientAttributes.hasOwnProperty(key)) {
        const element = this.clientAttributes[key];
        if (!element) {
          continue;
        }
        if (typeof element === 'object') {
          this.annotations[key] = element;
        } else {
          this.attributes[key] = element;
        }
      }
    }
  }
}
