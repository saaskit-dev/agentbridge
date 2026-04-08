type UpdatedSortable = {
  id: string;
  updatedAt: number;
  createdAt?: number;
  seq?: number;
};

type CreatedSortable = {
  id: string;
  createdAt: number;
  updatedAt?: number;
  seq?: number;
};

function compareOptionalNumberDesc(a?: number, b?: number): number {
  if (a === undefined && b === undefined) {
    return 0;
  }

  return (b ?? Number.NEGATIVE_INFINITY) - (a ?? Number.NEGATIVE_INFINITY);
}

function compareIdDesc(a: string, b: string): number {
  if (a === b) {
    return 0;
  }

  return a < b ? 1 : -1;
}

export function compareUpdatedDesc<T extends UpdatedSortable>(a: T, b: T): number {
  const updatedDiff = b.updatedAt - a.updatedAt;
  if (updatedDiff !== 0) {
    return updatedDiff;
  }

  const createdDiff = compareOptionalNumberDesc(a.createdAt, b.createdAt);
  if (createdDiff !== 0) {
    return createdDiff;
  }

  const seqDiff = compareOptionalNumberDesc(a.seq, b.seq);
  if (seqDiff !== 0) {
    return seqDiff;
  }

  return compareIdDesc(a.id, b.id);
}

export function compareCreatedDesc<T extends CreatedSortable>(a: T, b: T): number {
  const createdDiff = b.createdAt - a.createdAt;
  if (createdDiff !== 0) {
    return createdDiff;
  }

  const updatedDiff = compareOptionalNumberDesc(a.updatedAt, b.updatedAt);
  if (updatedDiff !== 0) {
    return updatedDiff;
  }

  const seqDiff = compareOptionalNumberDesc(a.seq, b.seq);
  if (seqDiff !== 0) {
    return seqDiff;
  }

  return compareIdDesc(a.id, b.id);
}
