import type { AuthoredLaneDeclarations } from "@seqlok/schema";

import type { CompilerIssue } from "./error";
import { compareUtf8, type FieldLocalHotReservation } from "./fields";
import type {
  CanonicalColdLaneDeclaration,
  CanonicalField,
  CanonicalHotLaneDeclaration,
  CanonicalLaneDeclarations,
  CanonicalWarmLaneDeclaration,
} from "./manifest";

export interface CanonicalizeLanesResult {
  readonly lanes: CanonicalLaneDeclarations;
  readonly issues: readonly CompilerIssue[];
}

export function canonicalizeLanes(
  authoredLanes: AuthoredLaneDeclarations | undefined,
  fields: readonly CanonicalField[],
  fieldLocalHotReservations: readonly FieldLocalHotReservation[],
): CanonicalizeLanesResult {
  const issues: CompilerIssue[] = [];
  const fieldByPath = new Map(fields.map((field) => [field.dotPath, field]));
  const hotDeclared = authoredLanes?.hot !== undefined;
  const lanes: MutableCanonicalLaneDeclarations = {};

  if (hotDeclared) {
    const reservations = canonicalizeHotReservations(
      authoredLanes.hot?.reservations ?? [],
      fieldLocalHotReservations,
    );
    issues.push(...validateHotReservations(reservations, fieldByPath));
    issues.push(...validateHotAdmissibility(fields, new Set(reservations)));
    lanes.hot = { codec: "mapped-fixed", reservations };
  } else {
    for (const reservation of fieldLocalHotReservations) {
      issues.push({
        code: "lane.hotReservationWithoutHotLane",
        path: reservation.path,
        message: "hot reservation declared without a hot lane",
      });
    }
  }

  if (authoredLanes?.warm !== undefined) {
    const codec = authoredLanes.warm.codec ?? "framed-snapshot";
    if (codec !== "framed-snapshot") {
      issues.push({
        code: "lane.warmCodecUnsupported",
        path: "lanes.warm.codec",
        message: "warm codec must be framed-snapshot",
      });
    } else {
      lanes.warm = { codec };
    }
  }

  if (authoredLanes?.cold !== undefined) {
    const materialization = authoredLanes.cold.materialization ?? "latest-snapshot";
    if (materialization !== "latest-snapshot" && materialization !== "checkpointed-snapshot") {
      issues.push({
        code: "lane.coldMaterializationUnsupported",
        path: "lanes.cold.materialization",
        message: "cold materialization is not supported",
      });
    } else {
      lanes.cold = { materialization };
    }
  }

  return { lanes, issues };
}

interface MutableCanonicalLaneDeclarations {
  hot?: CanonicalHotLaneDeclaration;
  warm?: CanonicalWarmLaneDeclaration;
  cold?: CanonicalColdLaneDeclaration;
}

function canonicalizeHotReservations(
  authoredReservations: readonly string[],
  fieldLocalHotReservations: readonly FieldLocalHotReservation[],
): readonly string[] {
  const reservationSet = new Set<string>();

  for (const reservation of authoredReservations) {
    reservationSet.add(reservation);
  }

  for (const reservation of fieldLocalHotReservations) {
    reservationSet.add(reservation.dotPath);
  }

  return [...reservationSet].sort(compareUtf8);
}

function validateHotReservations(
  reservations: readonly string[],
  fieldByPath: ReadonlyMap<string, CanonicalField>,
): readonly CompilerIssue[] {
  const issues: CompilerIssue[] = [];

  for (const reservation of reservations) {
    const field = fieldByPath.get(reservation);
    if (field === undefined) {
      issues.push({
        code: "lane.hotReservationUnknownField",
        path: `lanes.hot.reservations.${reservation}`,
        message: "hot reservation names a field that does not exist",
      });
      continue;
    }

    if (field.shape.kind !== "BoundedArray" && field.shape.kind !== "BoundedMap") {
      issues.push({
        code: "lane.hotReservationWrongShape",
        path: `lanes.hot.reservations.${reservation}`,
        message: "hot reservation must name a bounded array or bounded map field",
      });
    }
  }

  return issues;
}

function validateHotAdmissibility(
  fields: readonly CanonicalField[],
  reservations: ReadonlySet<string>,
): readonly CompilerIssue[] {
  const issues: CompilerIssue[] = [];

  for (const field of fields) {
    if (isHotAdmissible(field, reservations)) {
      continue;
    }

    issues.push({
      code: "lane.hotFieldNotAdmissible",
      path: `fields.${field.dotPath}`,
      message: `${field.shape.kind} is not hot-admissible without a fixed reservation`,
    });
  }

  return issues;
}

function isHotAdmissible(field: CanonicalField, reservations: ReadonlySet<string>): boolean {
  switch (field.shape.kind) {
    case "FixedScalar":
    case "FixedEnum":
    case "FixedVector":
    case "FixedStringEncoded":
      return true;

    case "BoundedArray":
    case "BoundedMap":
      return reservations.has(field.dotPath);

    case "VariableString":
    case "VariableMap":
      return false;
  }
}
