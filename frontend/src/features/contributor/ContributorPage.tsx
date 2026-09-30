import React, { useState } from 'react';
import PageTitle  from '../../components/ui/PageTitle';
import Button from '../../components/ui/Button'; // เอาปีกกาออกเพื่อให้ตรงกับการ Export แบบ Default

export const ContributorPage: React.FC = () => {
    const [word, setWord] = useState('');
    const [videoFile, setVideoFile] = useState<File | null>(null);
    const [status, setStatus] = useState('');

    const handleFileUpload = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!word || !videoFile) return alert('กรุณาระบุคำศัพท์และเลือกไฟล์วิดีโอ');

        const formData = new FormData();
        formData.append('word', word);
        formData.append('file', videoFile);

        setStatus('กำลังอัปโหลด...');
        try {
           const response = await fetch('http://localhost:8000/api/contributor/upload-video', {
                method: 'POST',
                body: formData,
            });
            const data = await response.json();
            setStatus(data.message);
        } catch (error) {
            setStatus('เกิดข้อผิดพลาดในการอัปโหลด');
        }
    };

    const handleTrain = async () => {
        setStatus('กำลังสั่งเทรนโมเดล...');
        await fetch('http://localhost:8000/api/contributor/train', { method: 'POST' });
        setStatus('เริ่มการเทรนโมเดลแล้ว กรุณารอสักครู่...');
    };

    const handlePublish = async () => {
        setStatus('กำลังเผยแพร่โมเดล...');
        const response = await fetch('http://localhost:8000/api/contributor/publish', { method: 'POST' });
        const data = await response.json();
        setStatus(data.message);
    };

    return (
        <div className="p-6 max-w-4xl mx-auto space-y-8">
            <PageTitle title="Contributor Workspace" subtitle="ระบบเพิ่มคำศัพท์และจัดการโมเดล" />

            {status && <div className="p-4 bg-blue-100 text-blue-800 rounded-md">{status}</div>}

            <div className="bg-white p-6 rounded-lg shadow-md border">
                <h2 className="text-xl font-bold mb-4">1. เพิ่มคำศัพท์ใหม่ (อัปโหลดวิดีโอ)</h2>
                <form onSubmit={handleFileUpload} className="space-y-4">
                    <div>
                        <label className="block text-sm font-medium mb-1">คำศัพท์</label>
                        <input
                            type="text"
                            value={word}
                            onChange={(e) => setWord(e.target.value)}
                            className="border p-2 rounded w-full"
                            placeholder="เช่น โรงพยาบาล"
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-medium mb-1">ไฟล์วิดีโอ (.mp4)</label>
                        <input
                            type="file"
                            accept="video/mp4"
                            onChange={(e) => setVideoFile(e.target.files?.[0] || null)}
                            className="border p-2 rounded w-full"
                        />
                    </div>
                    <Button type="submit">อัปโหลดวิดีโอ</Button>
                </form>
            </div>

            <div className="bg-white p-6 rounded-lg shadow-md border">
                <h2 className="text-xl font-bold mb-4">2. ฝึกสอนโมเดล (Train)</h2>
                <p className="text-gray-600 mb-4">เมื่อข้อมูลเพียงพอ ให้กดเพื่อสร้างโมเดลเวอร์ชันร่าง (Draft)</p>
                <Button onClick={handleTrain} className="bg-purple-600 hover:bg-purple-700">เริ่มเทรนโมเดลใหม่</Button>
            </div>

            <div className="bg-white p-6 rounded-lg shadow-md border">
                <h2 className="text-xl font-bold mb-4">3. ทดสอบและเผยแพร่ (Publish)</h2>
                <p className="text-gray-600 mb-4">เมื่อทดสอบแล้วมั่นใจ สามารถกดเผยแพร่ให้ผู้ใช้ทั่วไป (Normal User) ใช้งานได้ทันที</p>
                <div className="space-x-4">
                    <Button onClick={() => window.open('/sign-to-text?version=draft', '_blank')} className="bg-gray-600 hover:bg-gray-700">
                        ทดสอบโมเดลร่าง
                    </Button>
                    <Button onClick={handlePublish} className="bg-green-600 hover:bg-green-700">
                        เผยแพร่ (Publish)
                    </Button>
                </div>
            </div>
        </div>
    );
};