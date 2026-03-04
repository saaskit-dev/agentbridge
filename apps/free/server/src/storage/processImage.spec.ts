import * as fs from 'fs';
import { describe, it } from 'vitest';
import { processImage } from './processImage';

describe('processImage', () => {
  it('should resize image', async () => {
    const img = fs.readFileSync(__dirname + '/__testdata__/image.jpg');
    const result = await processImage(img);
  });
});
