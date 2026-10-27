import { test } from "node:test";
import assert from "node:assert/strict";
import {
  contentBox,
  normalizePoint,
  pinFromGesture,
  probeMime,
} from "../src/client/Recorder.js";

const box = { left: 0, top: 0, width: 400, height: 400 };

test("a letterboxed image maps a click at the image's top-left corner to (0, 0)", () => {
  // A 200 × 100 image shown with object-fit: contain in a 400 × 400 box
  // is drawn 400 × 200, with 100px bands above and below.
  const natural = { width: 200, height: 100 };
  assert.deepEqual(contentBox(box, natural, "contain", [0.5, 0.5]), {
    left: 0,
    top: 100,
    width: 400,
    height: 200,
  });
  assert.deepEqual(normalizePoint(0, 100, box, natural, "contain"), {
    x: 0,
    y: 0,
  });
  assert.deepEqual(normalizePoint(400, 300, box, natural, "contain"), {
    x: 1,
    y: 1,
  });
  assert.deepEqual(normalizePoint(200, 200, box, natural, "contain"), {
    x: 0.5,
    y: 0.5,
  });
  // A click in the letterbox band is not on the image.
  assert.equal(normalizePoint(10, 50, box, natural, "contain"), null);
});

test("object-position moves the letterboxed image box", () => {
  const natural = { width: 200, height: 100 };
  assert.deepEqual(normalizePoint(0, 0, box, natural, "contain", [0.5, 0]), {
    x: 0,
    y: 0,
  });
});

test("an unletterboxed image normalizes against its rendered box", () => {
  const offset = { left: 50, top: 20, width: 300, height: 600 };
  assert.deepEqual(
    normalizePoint(50, 20, offset, { width: 10, height: 10 }, "fill"),
    { x: 0, y: 0 },
  );
  assert.deepEqual(
    normalizePoint(200, 320, offset, { width: 10, height: 10 }, "fill"),
    { x: 0.5, y: 0.5 },
  );
});

test("a click drops a point pin; a drag makes a region pin inside the image", () => {
  assert.deepEqual(pinFromGesture({ x: 0.2, y: 0.3 }, { x: 0.201, y: 0.3 }), {
    kind: "point",
    x: 0.2,
    y: 0.3,
  });
  assert.deepEqual(pinFromGesture({ x: 0.6, y: 0.7 }, { x: 0.2, y: 0.1 }), {
    kind: "region",
    x: 0.2,
    y: 0.1,
    width: 0.4,
    height: 0.6,
  });
});

test("the recorder probes for the first supported mime type", () => {
  const only = (ok: string[]) => (t: string) => ok.includes(t);
  assert.equal(
    probeMime(only(["audio/webm;codecs=opus", "audio/mp4"]), false),
    "audio/webm;codecs=opus",
  );
  assert.equal(probeMime(only(["audio/mp4", "video/mp4"]), false), "audio/mp4");
  assert.equal(probeMime(only(["video/mp4"]), false), "video/mp4");
  // Screen capture needs a video container.
  assert.equal(
    probeMime(only(["audio/webm;codecs=opus", "video/webm"]), true),
    "video/webm",
  );
  assert.equal(probeMime(only([]), false), null);
});

test("a DOMRect-like box (getters on the prototype) normalizes too", () => {
  class Rect {
    get left() {
      return 10;
    }
    get top() {
      return 10;
    }
    get width() {
      return 100;
    }
    get height() {
      return 50;
    }
  }
  assert.deepEqual(
    normalizePoint(60, 35, new Rect(), { width: 2, height: 1 }, "fill"),
    { x: 0.5, y: 0.5 },
  );
});
