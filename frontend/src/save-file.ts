import { Directory, Filesystem } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { nativeApp } from './platform';

export async function saveFile(blob: Blob, name: string): Promise<void> {
  if (nativeApp) {
    const data = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(',', 2)[1]!);
      reader.onerror = () => reject(new Error('文件生成失败，请重试'));
      reader.readAsDataURL(blob);
    });
    const file = await Filesystem.writeFile({ path: 'exports/' + name, data, directory: Directory.Cache, recursive: true });
    await Share.share({ title: name, files: [file.uri], dialogTitle: '保存或分享导出文件' });
    return;
  }
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url; link.download = name; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
