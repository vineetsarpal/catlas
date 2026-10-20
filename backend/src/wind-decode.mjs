import { parentPort, workerData } from 'node:worker_threads';
import { createRequire } from 'node:module';
const { createEccodes } = createRequire(import.meta.url)('@meri-imperiumi/eccodes-wasm');
try {
  const started = performance.now();
  const decoder = await createEccodes();
  const { bytes, runAt, validAt } = workerData;
  const grids = bytes.map((buffer, index) => {
    const file = `/component-${index}.grib`;
    decoder.writeFile(file, new Uint8Array(buffer));
    const h = decoder.openGrib(file);
    try {
      const nx = h.getLong('Ni'), ny = h.getLong('Nj');
      if (nx !== 360 || ny !== 181 || ['iScansNegatively','jScansPositively','jPointsAreConsecutive','alternativeRowScanning'].some(k => h.getLong(k) !== 0)) throw Error('Unsupported GFS orientation');
      if (![index === 0 ? '10u' : '10v', index === 0 ? 'u' : 'v'].includes(h.getString('shortName')) || h.getLong('level') !== 10 || h.getString('units') !== 'm s**-1') throw Error('Unsupported wind component');
      for (const [date, dateKey, timeKey] of [[runAt,'dataDate','dataTime'],[validAt,'validityDate','validityTime']]) {
        if (h.getLong(dateKey) !== Number(date.slice(0,10).replaceAll('-','')) || h.getLong(timeKey) !== Number(date.slice(11,13))*100) throw Error('Wind forecast time mismatch');
      }
      const values = new Float32Array(h.getDoubleArray('values'));
      if (values.length !== nx*ny || !values.every(v => Number.isFinite(v) && Math.abs(v) < 180)) throw Error('Invalid wind values');
      const geometry = { nx, ny, lo1:h.getDouble('longitudeOfFirstGridPointInDegrees'), la1:h.getDouble('latitudeOfFirstGridPointInDegrees'), dx:h.getDouble('iDirectionIncrementInDegrees'), dy:h.getDouble('jDirectionIncrementInDegrees') };
      if (geometry.lo1 !== 0 || geometry.la1 !== 90 || geometry.dx !== 1 || geometry.dy !== 1) throw Error('Unsupported wind geometry');
      return { ...geometry, values };
    } finally { h.delete(); decoder.writeFile(file, new Uint8Array()); }
  });
  const [u,v] = grids;
  parentPort.postMessage({ nx:u.nx, ny:u.ny, lo1:u.lo1, la1:u.la1, dx:u.dx, dy:u.dy, u:u.values, v:v.values, decodeMs:performance.now()-started }, [u.values.buffer,v.values.buffer]);
} catch { parentPort.postMessage({error:'Wind decoding failed validation'}); }
