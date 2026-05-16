package com.example.prama.controller;

import com.example.prama.service.FileStorageService;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.HashMap;
import java.util.Map;

@RestController
@RequestMapping("/api/v1/streaming-upload")
@CrossOrigin(origins = "*")
public class StreamingUploadController {

    private final FileStorageService fileStorageService;

    public StreamingUploadController(FileStorageService fileStorageService) {
        this.fileStorageService = fileStorageService;
    }

    /**
     * Resumable Chunked Upload Endpoint (Backend Append Mode)
     * Receives 10MB chunks sequentially and appends them to a temporary file.
     */
    @PostMapping
    public ResponseEntity<?> upload(HttpServletRequest request,
                                    @RequestHeader("X-File-ID") String fileId,
                                    @RequestHeader("X-Chunk-Index") int chunkIndex,
                                    @RequestHeader("X-Total-Chunks") int totalChunks,
                                    @RequestHeader("X-File-Name") String fileName,
                                    @RequestHeader("X-Sender-Id") String senderId) {
        try {
            String result = fileStorageService.appendStream(
                    request.getInputStream(), 
                    fileId, 
                    chunkIndex, 
                    totalChunks, 
                    fileName, 
                    senderId
            );
            
            Map<String, Object> response = new HashMap<>();
            response.put("status", "success");
            response.put("chunkIndex", chunkIndex);
            
            // If the last chunk was processed, return the final URL
            if (chunkIndex >= totalChunks - 1) {
                response.put("url", "/api/v1/attachments/" + result);
                response.put("finalized", true);
            } else {
                response.put("finalized", false);
            }
            
            return ResponseEntity.ok(response);
        } catch (Exception e) {
            return ResponseEntity.status(500).body("Chunk upload failed at index " + chunkIndex + ": " + e.getMessage());
        }
    }
}
