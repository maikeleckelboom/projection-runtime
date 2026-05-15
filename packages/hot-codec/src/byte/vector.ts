import type { HotLayoutPlanningFixedVectorShape } from "../shape";
import { readScalar, scalarByteWidth, writeScalar } from "./scalar";
import type { HotFieldScalarValue, HotFieldValue } from "./types";
import { throwByteIssue } from "./types";
import { requireArray } from "./value";

export function writeVector(
  view: DataView,
  offset: number,
  shape: HotLayoutPlanningFixedVectorShape,
  value: HotFieldValue,
  path: string,
): void {
  const values = requireArray(value, path);
  if (values.length !== shape.length) {
    throwByteIssue(
      "byte.valueLengthInvalid",
      path,
      `FixedVector value length must be exactly ${shape.length}`,
    );
  }

  const elementByteWidth = scalarByteWidth(shape.elementType);
  for (let index = 0; index < values.length; index += 1) {
    const element = values[index];
    if (element === undefined) {
      throwByteIssue("byte.valueMissing", `${path}.${index}`, "missing FixedVector element");
    }
    writeScalar(
      view,
      offset + index * elementByteWidth,
      shape.elementType,
      element,
      `${path}.${index}`,
    );
  }
}

export function readVector(
  view: DataView,
  offset: number,
  shape: HotLayoutPlanningFixedVectorShape,
  path: string,
): readonly HotFieldScalarValue[] {
  const values: HotFieldScalarValue[] = [];
  const elementByteWidth = scalarByteWidth(shape.elementType);

  for (let index = 0; index < shape.length; index += 1) {
    values.push(
      readScalar(view, offset + index * elementByteWidth, shape.elementType, `${path}.${index}`),
    );
  }

  return values;
}
