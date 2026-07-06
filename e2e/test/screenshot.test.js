import { expect } from 'chai';
import { framework } from '../test-framework.js';
import { expectValidTabInfo, decodePng, colorShare } from './helpers.js';

// Capture as png at full scale so pixel colors can be asserted exactly
async function screenshotPng(args = {}) {
  const result = await framework.callTool('screenshot', { format: 'png', scale: 1, ...args });
  const data = JSON.parse(result.content[0].text);
  const image = result.content[1] ? decodePng(Buffer.from(result.content[1].data, 'base64')) : null;
  return { data, image };
}

describe('Screenshot Tool Tests', function() {
  beforeEach(async function() {
    // Navigate to test page to ensure clean state (scroll position 0)
    await framework.callTool('navigate', {
      url: "http://localhost:61822/test.html"
    });
  });

  it('should capture the viewport at the top of the page', async function() {
    const { data, image } = await screenshotPng();

    expectValidTabInfo(data);
    expect(data.success).to.equal(true);
    expect(image).to.not.equal(null);
    // The top of the page is form controls on white - none of the solid
    // below-the-fold marker colors should dominate
    expect(colorShare(image, 'red')).to.be.lessThan(0.5);
    expect(colorShare(image, 'blue')).to.be.lessThan(0.5);
  });

  it('should capture an element below the fold without scrolling', async function() {
    const { data, image } = await screenshotPng({ selector: '#screenshot-below-fold' });

    expectValidTabInfo(data);
    expect(data.success).to.equal(true);
    expect(data.scrollPosition.y).to.equal(0); // capture must not require scrolling
    expect(image).to.not.equal(null);
    expect(colorShare(image, 'red')).to.be.greaterThan(0.85);
  });

  it('should capture the visible viewport when the page is scrolled', async function() {
    // Find where the tall solid-blue block starts (page is at scroll 0)
    const elements = await framework.callToolAndParse('elements', { selector: '#screenshot-tall-block' });
    const blockTop = elements.elements[0].bounds.y;

    // Scroll so the viewport sits fully inside the block
    const scrolled = await framework.callToolAndParse('scroll', { y: Math.round(blockTop) + 50 });
    expect(scrolled.scrollPosition.y).to.be.greaterThan(0);

    const { data, image } = await screenshotPng();

    expect(data.success).to.equal(true);
    expect(image).to.not.equal(null);
    expect(colorShare(image, 'blue')).to.be.greaterThan(0.85);
  });

  it('should capture a fixed element while the page is scrolled', async function() {
    await framework.callToolAndParse('scroll', { y: 500 });

    const { data, image } = await screenshotPng({ selector: '#screenshot-fixed' });

    expect(data.success).to.equal(true);
    expect(image).to.not.equal(null);
    // The square sits at the viewport's right edge; a scrollbar can shave a
    // strip off the capture surface. A wrong clip region scores ~0.
    expect(colorShare(image, 'green')).to.be.greaterThan(0.7);
  });

  it('should report an error for an element with no rendered size', async function() {
    const { data } = await screenshotPng({ selector: '#screenshot-hidden' });

    expect(data.success).to.equal(false);
    expect(data.error.code).to.equal('SCREENSHOT_ERROR');
  });

  it('should report element not found', async function() {
    const { data } = await screenshotPng({ selector: '#does-not-exist' });

    expect(data.success).to.equal(false);
    expect(data.error.code).to.equal('ELEMENT_NOT_FOUND');
  });
});
