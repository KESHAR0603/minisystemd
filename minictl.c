
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/socket.h>
#include <sys/un.h>
#include <unistd.h>

#define SOCKET_PATH "/tmp/minisystemd.sock"

int main(int argc, char *argv[]) {
    if (argc < 2) {
        printf("Usage: ./minictl <command> [service_name]\n");
        printf("Commands:\n");
        printf("  status                 - Show daemon and service states\n");
        printf("  start <service_name>   - Start a loaded service\n");
        return 1;
    }

    if (strcmp(argv[1], "start") == 0 && argc < 3) {
        fprintf(stderr, "Usage: ./minictl start <service_name>\n");
        return 1;
    }

    char command[256] = {0};
    for (int i = 1; i < argc; i++) {
        if (i > 1) {
            strncat(command, " ", sizeof(command) - strlen(command) - 1);
        }
        strncat(command, argv[i], sizeof(command) - strlen(command) - 1);
    }

    int sock = socket(AF_UNIX, SOCK_STREAM, 0);
    if (sock < 0) {
        perror("Socket creation failed");
        return 1;
    }

    struct sockaddr_un addr;
    memset(&addr, 0, sizeof(addr));
    addr.sun_family = AF_UNIX;
    strncpy(addr.sun_path, SOCKET_PATH, sizeof(addr.sun_path) - 1);

    if (connect(sock, (struct sockaddr *)&addr, sizeof(addr)) < 0) {
        perror("Failed to connect to mini-systemd daemon. Is it running?");
        close(sock);
        return 1;
    }

    if (write(sock, command, strlen(command) + 1) < 0) {
        perror("Failed to send command");
        close(sock);
        return 1;
    }

    char buffer[512];
    ssize_t n = read(sock, buffer, sizeof(buffer) - 1);
    if (n > 0) {
        buffer[n] = '\0';
        printf("[minictl response] %s\n", buffer);
    } else if (n == 0) {
        fprintf(stderr, "Daemon closed the connection without a response.\n");
        close(sock);
        return 1;
    } else {
        perror("Failed to read response");
        close(sock);
        return 1;
    }

    close(sock);
    return 0;
}
