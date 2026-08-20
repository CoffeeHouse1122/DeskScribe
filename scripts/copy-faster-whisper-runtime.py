import argparse
import importlib.metadata
import shutil
from pathlib import Path

from packaging.requirements import Requirement


def normalized_name(value: str) -> str:
    return value.lower().replace("_", "-").replace(".", "-")


def dependency_closure(root_name: str):
    pending = [root_name]
    distributions = {}
    while pending:
        requested_name = pending.pop()
        distribution = importlib.metadata.distribution(requested_name)
        name = distribution.metadata["Name"]
        key = normalized_name(name)
        if key in distributions:
            continue
        distributions[key] = distribution
        for raw_requirement in distribution.requires or []:
            requirement = Requirement(raw_requirement)
            if requirement.marker and not requirement.marker.evaluate({"extra": ""}):
                continue
            pending.append(requirement.name)
    return distributions


def copy_distribution(distribution, source_root: Path, target_root: Path) -> None:
    for relative_file in distribution.files or []:
        source = Path(distribution.locate_file(relative_file)).resolve()
        try:
            relative = source.relative_to(source_root)
        except ValueError:
            continue
        if not source.is_file():
            continue
        target = target_root / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, target)


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Copy the minimal installed Faster-Whisper dependency closure."
    )
    parser.add_argument("target", type=Path)
    args = parser.parse_args()

    root_distribution = importlib.metadata.distribution("faster-whisper")
    source_root = Path(root_distribution.locate_file("")).resolve()
    runtime_root = args.target.resolve()
    runtime_root.mkdir(parents=True, exist_ok=True)
    if any(runtime_root.iterdir()):
        raise SystemExit(f"Target directory must be empty: {runtime_root}")
    target_root = runtime_root / "Lib" / "site-packages"
    target_root.mkdir(parents=True)

    distributions = dependency_closure("faster-whisper")
    for name in sorted(distributions):
        distribution = distributions[name]
        copy_distribution(distribution, source_root, target_root)
        print(f"Copied {distribution.metadata['Name']} {distribution.version}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
