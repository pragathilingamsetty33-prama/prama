package com.example.prama.service;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.nio.file.StandardCopyOption;
import java.util.UUID;

@Service
public class FileStorageService {

    @Value("${app.upload.dir:C:/Users/Mani/OneDrive/Desktop/prama/uploads/}")
    private String uploadDir;

    /**
     * Appends a chunk stream to a temporary file.
     * Finalizes the file (moves to permanent storage) when the last chunk is received.
     */
    public synchronized String appendStream(InputStream inputStream, 
                                            String fileId, 
                                            int chunkIndex, 
                                            int totalChunks, 
                                            String originalFilename, 
                                            String senderId) throws IOException {
        Path root = Paths.get(uploadDir);
        Path tempDir = root.resolve("temp");
        if (!Files.exists(tempDir)) {
            Files.createDirectories(tempDir);
        }

        // Identify the temporary file by the unique File-ID
        Path tempFilePath = tempDir.resolve(fileId + ".part");
        
        // Open in append mode. If it's the first chunk, the file will be created.
        try (FileOutputStream outputStream = new FileOutputStream(tempFilePath.toFile(), true)) {
            byte[] buffer = new byte[8192]; // 8KB Pipe
            int bytesRead;
            while ((bytesRead = inputStream.read(buffer)) != -1) {
                outputStream.write(buffer, 0, bytesRead);
            }
        }

        // Check if this is the final chunk
        if (chunkIndex >= totalChunks - 1) {
            String storedFilename = UUID.randomUUID().toString() + "_" + originalFilename;
            Path finalPath = root.resolve(storedFilename);
            
            // Atomically move the completed file to the permanent uploads directory
            Files.move(tempFilePath, finalPath, StandardCopyOption.REPLACE_EXISTING);
            
            saveMetadata(finalPath.toString(), originalFilename, senderId);
            return storedFilename;
        }

        return "uploading_chunk_" + chunkIndex;
    }

    private void saveMetadata(String storedPath, String originalName, String senderId) {
        // TODO: Implement JPA repository call here
    }
}
