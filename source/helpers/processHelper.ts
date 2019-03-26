import * as process from 'process';
import * as fs from 'fs';

export function readProcessStatus(): object {
  const sys = process.platform;
  if (sys === 'win32') {
    return {};
  }
  // Justification for doing this synchronously:
  // * We need to collect this information in the process uncaughtException handler, in which the
  //   event loop is not safe to use.
  // * We are collecting a snapshot of virtual memory used. If this is done asynchronously, then
  //   we may pick up virtual memory information for a time different than the moment we are
//   interested in.
  // * procfs is a virtual filesystem; there is no disk I/O to block on. It's synchronous anyway.
  let contents;
  try {
    contents = fs.readFileSync('/proc/self/status', { encoding: 'utf8' });
  } catch (err) {
    return {};
  }
  const result = {} as any;
  for (var i = 0; i < _procSelfStatusData.length; i += 1) {
    var item = _procSelfStatusData[i];
    var match = contents.match(item.re);
    if (!match) {
      continue;
    }
    result[item.attr] = item.parse(match[1]);
  }

  return result;
}

function parseKb(str: string): number {
  return parseInt(str) * 1024;
}
const _procSelfStatusData = [
  {
    re: /^nonvoluntary_ctxt_switches:\s+(\d+)$/m,
    parse: parseInt,
    attr: 'sched.cs.involuntary',
  },
  {
    re: /^voluntary_ctxt_switches:\s+(\d+)$/m,
    parse: parseInt,
    attr: 'sched.cs.voluntary',
  },
  { re: /^FDSize:\s+(\d+)$/m, parse: parseInt, attr: 'descriptor.count' },
  { re: /^FDSize:\s+(\d+)$/m, parse: parseInt, attr: 'descriptor.count' },
  { re: /^VmData:\s+(\d+)\s+kB$/m, parse: parseKb, attr: 'vm.data.size' },
  { re: /^VmLck:\s+(\d+)\s+kB$/m, parse: parseKb, attr: 'vm.locked.size' },
  { re: /^VmPTE:\s+(\d+)\s+kB$/m, parse: parseKb, attr: 'vm.pte.size' },
  { re: /^VmHWM:\s+(\d+)\s+kB$/m, parse: parseKb, attr: 'vm.rss.peak' },
  { re: /^VmRSS:\s+(\d+)\s+kB$/m, parse: parseKb, attr: 'vm.rss.size' },
  { re: /^VmLib:\s+(\d+)\s+kB$/m, parse: parseKb, attr: 'vm.shared.size' },
  { re: /^VmStk:\s+(\d+)\s+kB$/m, parse: parseKb, attr: 'vm.stack.size' },
  { re: /^VmSwap:\s+(\d+)\s+kB$/m, parse: parseKb, attr: 'vm.swap.size' },
  { re: /^VmPeak:\s+(\d+)\s+kB$/m, parse: parseKb, attr: 'vm.vma.peak' },
  { re: /^VmSize:\s+(\d+)\s+kB$/m, parse: parseKb, attr: 'vm.vma.size' },
];
