// Created by The Angelo Umali.
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { DropZone } from "../src/components/drop-zone.tsx";

function videoFile(name: string): File {
  return new File(["frames"], name, { type: "video/mp4" });
}

function renderZone() {
  const onFiles = vi.fn<(files: File[]) => void>();
  const onPickInPlace = vi.fn<() => void>();
  render(<DropZone onFiles={onFiles} onPickInPlace={onPickInPlace} />);
  return { onFiles, onPickInPlace, zone: screen.getByTestId("drop-zone") };
}

describe("DropZone", () => {
  it("hands over every dropped file", () => {
    const { onFiles, zone } = renderZone();
    const files = [videoFile("a.mp4"), videoFile("b.mov")];
    fireEvent.drop(zone, { dataTransfer: { files, types: ["Files"] } });

    expect(onFiles).toHaveBeenCalledWith(files);
  });

  it("shows the drop target while files hover over it", () => {
    const { zone } = renderZone();
    fireEvent.dragEnter(zone, { dataTransfer: { files: [], types: ["Files"] } });
    expect(zone).toHaveAttribute("data-dragging", "true");

    fireEvent.drop(zone, { dataTransfer: { files: [], types: ["Files"] } });
    expect(zone).toHaveAttribute("data-dragging", "false");
  });

  it("offers a file chooser as the non-drag path", async () => {
    const { onFiles } = renderZone();
    const files = [videoFile("a.mp4"), videoFile("b.mp4")];
    await userEvent.upload(screen.getByLabelText("Video files"), files);

    expect(onFiles).toHaveBeenCalledWith(files);
    expect(screen.getByRole("button", { name: "Choose files" })).toBeVisible();
  });

  it("opens the in-place picker", async () => {
    const { onPickInPlace } = renderZone();
    await userEvent.click(screen.getByRole("button", { name: "Use a file in place" }));

    expect(onPickInPlace).toHaveBeenCalledOnce();
  });
});
